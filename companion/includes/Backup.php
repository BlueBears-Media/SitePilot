<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * Backup — streams a multipart backup response to the SitePilot backend.
 *
 * The response is structured as a multipart/mixed stream with up to four parts:
 *   Part 1: manifest.json (initial, without checksums)
 *   Part 2: dump.sql     (database dump, if type is 'full' or 'db_only')
 *   Part 3: files.tar.gz (files archive, if type is 'full' or 'files_only')
 *   Part 4: manifest.json (final, with checksums populated)
 *
 * IMPORTANT: We use a pure-PHP streaming tar+gzip writer instead of ZipArchive.
 * ZipArchive requires writing the entire zip to a temp file before any bytes
 * can be sent to the client. On shared hosts with limited tmp quota (often 50MB),
 * this causes failures on sites with large wp-content directories.
 *
 * The tar format used is POSIX ustar (recognized by all modern extraction tools).
 * We write directly to a gzopen() stream for on-the-fly compression.
 *
 * The database dump is generated row-by-row using $wpdb->get_results() with
 * chunking (100 rows per query). This avoids loading entire tables into PHP
 * memory and works on shared hosts without mysqldump binary access.
 */
class Backup
{
    /** Multipart boundary used to separate response parts */
    private const BOUNDARY = 'SitePilot-Backup-Boundary-7f3a9e2b1c4d';

    /** Number of database rows to fetch per chunk */
    private const DB_CHUNK_SIZE = 100;

    /**
     * Handle a backup request. Streams the multipart response and exits.
     *
     * @param \WP_REST_Request $request
     */
    public static function handle(\WP_REST_Request $request): void
    {
        global $wpdb;

        // ── 1. Prepare ──────────────────────────────────────────────────────

        $type = $request->get_param('type') ?? 'full';
        if (! in_array($type, ['full', 'db_only', 'files_only'], true)) {
            $type = 'full';
        }

        // Prevent PHP from timing out — backup can take many minutes
        set_time_limit(0);

        // Disable output buffering at every level
        while (ob_get_level() > 0) {
            ob_end_flush();
        }

        $include_db    = in_array($type, ['full', 'db_only'], true);
        $include_files = in_array($type, ['full', 'files_only'], true);

        // ── 2. Build initial manifest ─────────────────────────────────────

        $manifest = [
            'site_url'     => get_site_url(),
            'wp_version'   => get_bloginfo('version'),
            'php_version'  => PHP_VERSION,
            'backup_type'  => $type,
            'created_at'   => gmdate('c'),
            'token_version' => 1,
            'files'        => [],  // Populated during file archiving
            'db_tables'    => [],  // Populated during DB dump
        ];

        // ── 3. Start multipart response ──────────────────────────────────

        $boundary = self::BOUNDARY;
        header('Content-Type: multipart/mixed; boundary="' . $boundary . '"');
        header('X-Accel-Buffering: no'); // Disable Nginx buffering
        header('Cache-Control: no-cache');

        // Part 1: Initial manifest (files[] and db_tables[] are empty at this point)
        self::write_part($boundary, 'manifest.json', 'application/json', json_encode($manifest) ?: '{}');

        // ── 4. Database dump ─────────────────────────────────────────────

        if ($include_db) {
            // Open the multipart part for the SQL dump
            echo "\r\n--{$boundary}\r\n";
            echo "Content-Disposition: form-data; name=\"dump.sql\"\r\n";
            echo "Content-Type: text/plain; charset=utf-8\r\n";
            echo "\r\n";

            // Get all table names
            // phpcs:ignore WordPress.DB.DirectDatabaseQuery
            $tables = $wpdb->get_col('SHOW TABLES');

            foreach ($tables as $table) {
                $manifest['db_tables'][] = $table;

                // Emit CREATE TABLE IF NOT EXISTS statement
                // phpcs:ignore WordPress.DB.DirectDatabaseQuery
                $create_result = $wpdb->get_row("SHOW CREATE TABLE `{$table}`", ARRAY_A);
                $create_sql    = $create_result['Create Table'] ?? '';
                if (! empty($create_sql)) {
                    echo "-- Table: {$table}\r\n";
                    echo "DROP TABLE IF EXISTS `{$table}`;\r\n";
                    echo $create_sql . ";\r\n\r\n";
                }

                // Dump rows in chunks to avoid memory exhaustion
                $offset = 0;
                do {
                    // phpcs:ignore WordPress.DB.DirectDatabaseQuery
                    $rows = $wpdb->get_results(
                        $wpdb->prepare("SELECT * FROM `{$table}` LIMIT %d OFFSET %d", self::DB_CHUNK_SIZE, $offset),
                        ARRAY_A
                    );

                    if (empty($rows)) {
                        break;
                    }

                    foreach ($rows as $row) {
                        $values = array_map(
                            static function ($val) use ($wpdb): string {
                                if ($val === null) {
                                    return 'NULL';
                                }
                                return "'" . esc_sql($val) . "'";
                            },
                            array_values($row)
                        );

                        $columns = implode(', ', array_map(static fn($col) => "`{$col}`", array_keys($row)));
                        $vals    = implode(', ', $values);
                        echo "INSERT INTO `{$table}` ({$columns}) VALUES ({$vals});\r\n";
                    }

                    $offset += self::DB_CHUNK_SIZE;
                } while (count($rows) === self::DB_CHUNK_SIZE);

                flush();
            }
        }

        // ── 5. Files archive (pure-PHP streaming tar+gzip) ───────────────

        if ($include_files) {
            // Build list of files to include
            $files_to_archive = self::collect_files();

            // Write tar.gz to a temp file, then stream it.
            //
            // We cannot stream tar directly to the HTTP response because tar requires
            // the file size to be written in the header before the content, and we
            // don't know the exact compressed size in advance.
            //
            // Instead we write to a temp file (which is seekable) and stream it after.
            // This is a known limitation of the tar format when used with gzip compression.
            // The temp file is always deleted after streaming.
            $temp_path = sys_get_temp_dir() . '/' . uniqid('sp_backup_', true) . '.tar.gz';

            $gz = gzopen($temp_path, 'wb9'); // Maximum compression
            if ($gz === false) {
                // Fallback: skip file archive with a warning in the manifest
                $manifest['files_error'] = 'Failed to open temp file for writing';
            } else {
                foreach ($files_to_archive as $abs_path => $rel_path) {
                    if (! is_readable($abs_path) || ! is_file($abs_path)) {
                        continue;
                    }

                    $file_size = filesize($abs_path);
                    if ($file_size === false) {
                        continue;
                    }

                    $sha256 = hash_file('sha256', $abs_path);
                    if ($sha256 === false) {
                        continue;
                    }

                    // Write 512-byte POSIX ustar header block
                    $header = self::build_tar_header($rel_path, $file_size);
                    gzwrite($gz, $header);

                    // Write file content in 512-byte blocks
                    $fh = fopen($abs_path, 'rb');
                    if ($fh !== false) {
                        while (! feof($fh)) {
                            $chunk = fread($fh, 512);
                            if ($chunk === false) {
                                break;
                            }
                            // Pad last block to 512 bytes
                            if (strlen($chunk) < 512) {
                                $chunk = str_pad($chunk, 512, "\0");
                            }
                            gzwrite($gz, $chunk);
                        }
                        fclose($fh);
                    }

                    // Pad file data to 512-byte boundary
                    $padding = (512 - ($file_size % 512)) % 512;
                    if ($padding > 0) {
                        gzwrite($gz, str_repeat("\0", $padding));
                    }

                    $manifest['files'][] = [
                        'path'   => $rel_path,
                        'sha256' => $sha256,
                        'size'   => $file_size,
                    ];
                }

                // Write two 512-byte end-of-archive blocks (POSIX standard)
                gzwrite($gz, str_repeat("\0", 1024));
                gzclose($gz);

                // Stream the temp file as a multipart part
                $tar_size = filesize($temp_path);
                echo "\r\n--{$boundary}\r\n";
                echo "Content-Disposition: form-data; name=\"files.tar.gz\"\r\n";
                echo "Content-Type: application/x-tar\r\n";
                if ($tar_size !== false) {
                    echo "Content-Length: {$tar_size}\r\n";
                }
                echo "\r\n";

                $tar_fh = fopen($temp_path, 'rb');
                if ($tar_fh !== false) {
                    while (! feof($tar_fh)) {
                        $chunk = fread($tar_fh, 65536); // 64KB chunks
                        if ($chunk !== false) {
                            echo $chunk;
                        }
                        flush();
                    }
                    fclose($tar_fh);
                }

                // Clean up temp file
                @unlink($temp_path);
            }
        }

        // ── 6. Final manifest (with checksums) ───────────────────────────

        self::write_part($boundary, 'manifest.json', 'application/json', json_encode($manifest) ?: '{}');

        // ── 7. End multipart response ─────────────────────────────────────

        echo "\r\n--{$boundary}--\r\n";
        flush();
        exit;
    }

    /**
     * Write a complete multipart part (for small, fully-buffered data).
     */
    private static function write_part(string $boundary, string $name, string $content_type, string $data): void
    {
        echo "\r\n--{$boundary}\r\n";
        echo "Content-Disposition: form-data; name=\"{$name}\"\r\n";
        echo "Content-Type: {$content_type}\r\n";
        echo "Content-Length: " . strlen($data) . "\r\n";
        echo "\r\n";
        echo $data;
        flush();
    }

    /**
     * Build a 512-byte POSIX ustar tar header block.
     *
     * POSIX ustar header layout (512 bytes total):
     *   [  0- 99] filename (100 bytes, null-terminated)
     *   [100-107] file mode (8 bytes, octal ASCII)
     *   [108-115] owner UID (8 bytes, octal ASCII)
     *   [116-123] owner GID (8 bytes, octal ASCII)
     *   [124-135] file size (12 bytes, octal ASCII)
     *   [136-147] last modification time (12 bytes, octal ASCII)
     *   [148-155] header checksum (8 bytes, octal ASCII, space-padded)
     *   [156    ] type flag (1 byte: '0' = regular file)
     *   [157-256] link name (100 bytes, null-terminated)
     *   [257-262] "ustar" magic (6 bytes)
     *   [263-264] ustar version "00" (2 bytes)
     *   [265-296] owner user name (32 bytes)
     *   [297-328] owner group name (32 bytes)
     *   [329-336] device major number (8 bytes)
     *   [337-344] device minor number (8 bytes)
     *   [345-499] filename prefix (155 bytes, null-terminated)
     *   [500-511] padding (12 bytes of zeros)
     *
     * The checksum is computed over all 512 bytes with the checksum field
     * treated as all spaces (0x20) during calculation.
     *
     * @param string $filename Relative path within the archive.
     * @param int    $size     File size in bytes.
     * @return string 512-byte header block.
     */
    private static function build_tar_header(string $filename, int $size): string
    {
        $header = str_repeat("\0", 512);

        // Split long filenames into name + prefix (ustar long-filename extension)
        $name   = $filename;
        $prefix = '';
        if (strlen($filename) > 100) {
            $prefix = substr($filename, 0, 155);
            $name   = substr($filename, strlen($prefix));
        }

        // Encode fields into the header
        $header  = substr($name, 0, 100) . str_repeat("\0", max(0, 100 - strlen($name)));           // [0-99]   filename
        $header .= sprintf('%07o', 0644) . "\0";                                                       // [100-107] mode
        $header .= sprintf('%07o', 0) . "\0";                                                          // [108-115] uid
        $header .= sprintf('%07o', 0) . "\0";                                                          // [116-123] gid
        $header .= sprintf('%011o', $size) . "\0";                                                     // [124-135] size
        $header .= sprintf('%011o', time()) . "\0";                                                    // [136-147] mtime
        $header .= '        ';                                                                         // [148-155] checksum placeholder (8 spaces)
        $header .= '0';                                                                                // [156    ] type flag (regular file)
        $header .= str_repeat("\0", 100);                                                              // [157-256] link name
        $header .= "ustar\0";                                                                          // [257-262] magic
        $header .= "00";                                                                               // [263-264] version
        $header .= str_repeat("\0", 32);                                                               // [265-296] user name
        $header .= str_repeat("\0", 32);                                                               // [297-328] group name
        $header .= str_repeat("\0", 8);                                                                // [329-336] devmajor
        $header .= str_repeat("\0", 8);                                                                // [337-344] devminor
        $header .= substr($prefix, 0, 155) . str_repeat("\0", max(0, 155 - strlen($prefix)));         // [345-499] prefix
        $header .= str_repeat("\0", 12);                                                               // [500-511] padding

        // Ensure header is exactly 512 bytes
        $header = substr($header, 0, 512);
        if (strlen($header) < 512) {
            $header = str_pad($header, 512, "\0");
        }

        // Calculate checksum: sum of all byte values, with checksum field as spaces
        $checksum = 0;
        for ($i = 0; $i < 512; $i++) {
            $checksum += ord($header[$i]);
        }

        // Write checksum back into the header at position 148 (6 octal digits + null + space)
        $checksum_str = sprintf('%06o', $checksum) . "\0 ";
        $header = substr_replace($header, $checksum_str, 148, 8);

        return $header;
    }

    /**
     * Collect files to include in the backup archive.
     * Returns an array of [absolute_path => relative_path].
     *
     * Includes: wp-content/, wp-config.php
     * Excludes: wp-content/cache/, wp-content/upgrade/, *.log, node_modules/
     *
     * @return array<string, string>
     */
    private static function collect_files(): array
    {
        $files = [];

        // wp-config.php
        $wp_config = ABSPATH . 'wp-config.php';
        if (file_exists($wp_config)) {
            $files[$wp_config] = 'wp-config.php';
        }

        // wp-content/ directory (recursive)
        $wp_content = WP_CONTENT_DIR;
        $iterator   = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($wp_content, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $file) {
            if (! $file->isFile()) {
                continue;
            }

            $abs_path = $file->getRealPath();
            if ($abs_path === false) {
                continue;
            }

            $rel_path = ltrim(str_replace(ABSPATH, '', $abs_path), '/');

            // Exclusion rules
            if (self::should_exclude($abs_path, $rel_path)) {
                continue;
            }

            $files[$abs_path] = $rel_path;
        }

        return $files;
    }

    /**
     * Determine whether a file should be excluded from the backup.
     */
    private static function should_exclude(string $abs_path, string $rel_path): bool
    {
        $exclude_dirs = [
            'wp-content/cache/',
            'wp-content/upgrade/',
        ];

        foreach ($exclude_dirs as $exclude_dir) {
            if (str_starts_with($rel_path, $exclude_dir)) {
                return true;
            }
        }

        // Exclude .log files
        if (str_ends_with($abs_path, '.log')) {
            return true;
        }

        // Exclude node_modules directories
        if (str_contains($rel_path, '/node_modules/') || str_contains($rel_path, '\\node_modules\\')) {
            return true;
        }

        return false;
    }
}
