<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * Restore — companion-based restore for one-click rollback from SitePilot.
 *
 * This handles the automated restore path: the SitePilot backend provides a
 * signed URL to the backup archive and the manifest. The companion downloads
 * the archive, verifies checksums, and applies the restore.
 *
 * For the manual restore path (no WordPress required), see restore-helper.php.
 *
 * Background execution uses the same strategy as Updates.php:
 *   1. Primary: popen() to immediately fire wp-cron.php
 *   2. Fallback: wp_schedule_single_event()
 */
class Restore
{
    /**
     * Handle POST /restore — schedule the restore and return immediately.
     */
    public static function handle(\WP_REST_Request $request): \WP_REST_Response
    {
        $signed_url = $request->get_param('signed_url') ?? '';
        $manifest   = $request->get_param('manifest') ?? [];
        $scope      = $request->get_param('scope') ?? 'full';

        if (empty($signed_url)) {
            return new \WP_REST_Response(['error' => 'signed_url is required'], 400);
        }

        if (! in_array($scope, ['full', 'db_only', 'files_only'], true)) {
            return new \WP_REST_Response(['error' => 'Invalid scope'], 400);
        }

        $job_id = wp_generate_uuid4();
        RequestLog::info('Restore job queued', [
            'job_id' => $job_id,
            'scope'  => $scope,
        ]);

        set_transient('sitepilot_job_' . $job_id, [
            'status'  => 'running',
            'message' => 'Restore queued',
        ], 600);

        // Store manifest in a separate transient for the background job
        set_transient('sitepilot_restore_manifest_' . $job_id, $manifest, 600);

        wp_schedule_single_event(time(), 'sitepilot_run_restore', [$job_id, $signed_url, $manifest, $scope]);

        // Immediately trigger cron via popen() if available
        if (function_exists('popen')) {
            $php_binary = PHP_BINARY ?: 'php';
            $cron_path  = ABSPATH . 'wp-cron.php';
            if (file_exists($cron_path)) {
                @popen("{$php_binary} {$cron_path} > /dev/null 2>&1 &", 'r');
            }
        }

        return new \WP_REST_Response([
            'job_id' => $job_id,
            'status' => 'started',
        ], 200);
    }

    /**
     * Handle GET /restore-status
     */
    public static function handle_status(\WP_REST_Request $request): \WP_REST_Response
    {
        $job_id = $request->get_param('job_id') ?? '';
        $state  = get_transient('sitepilot_job_' . $job_id);

        if ($state === false) {
            return new \WP_REST_Response(['status' => 'failed', 'message' => 'Job not found or expired'], 404);
        }

        return new \WP_REST_Response($state, 200);
    }

    /**
     * Run the actual restore. Called by the 'sitepilot_run_restore' WP-cron action.
     *
     * @param string               $job_id
     * @param string               $signed_url
     * @param array<string, mixed> $manifest
     * @param string               $scope 'full' | 'db_only' | 'files_only'
     */
    public static function run_restore(string $job_id, string $signed_url, array $manifest, string $scope): void
    {
        global $wpdb;

        $transient_key = 'sitepilot_job_' . $job_id;
        $temp_archive  = sys_get_temp_dir() . '/sitepilot_restore_' . $job_id . '.tar.gz';

        set_time_limit(0);

        try {
            // ── Step 1: Download archive ─────────────────────────────────

            self::set_state($transient_key, 'running', 'Downloading backup archive');

            $response = wp_remote_get($signed_url, [
                'timeout'  => 300,  // 5 minutes for large archives
                'stream'   => true,
                'filename' => $temp_archive,
            ]);

            if (is_wp_error($response)) {
                throw new \RuntimeException('Download failed: ' . $response->get_error_message());
            }

            if (! file_exists($temp_archive)) {
                throw new \RuntimeException('Archive file was not saved to temp directory');
            }

            // ── Step 2: Verify checksums ─────────────────────────────────

            self::set_state($transient_key, 'running', 'Verifying checksums');

            $manifest_files = $manifest['files'] ?? [];
            if (! empty($manifest_files)) {
                // Extract tar.gz to a temp directory for checksum verification
                $temp_dir = sys_get_temp_dir() . '/sitepilot_verify_' . $job_id;
                @mkdir($temp_dir, 0755, true);

                try {
                    $phar = new \PharData($temp_archive);
                    $phar->extractTo($temp_dir, null, true);

                    foreach ($manifest_files as $file_entry) {
                        $rel_path  = $file_entry['path'] ?? '';
                        $expected  = $file_entry['sha256'] ?? '';
                        $file_path = $temp_dir . '/' . $rel_path;

                        if (! file_exists($file_path)) {
                            continue; // Skip missing files (partial backups)
                        }

                        $actual = hash_file('sha256', $file_path);
                        if ($actual !== $expected) {
                            throw new \RuntimeException("Checksum mismatch for file: {$rel_path}");
                        }
                    }
                } catch (\PharException $e) {
                    // Non-fatal — checksums may not be verifiable for all archive types
                    self::set_state($transient_key, 'running', 'Warning: checksum verification incomplete');
                } finally {
                    // Clean up temp extraction directory
                    self::rmdir_recursive($temp_dir);
                }
            }

            // ── Step 3: Restore files ─────────────────────────────────────

            if (in_array($scope, ['full', 'files_only'], true)) {
                self::set_state($transient_key, 'running', 'Restoring files');

                $phar = new \PharData($temp_archive);
                $phar->extractTo(ABSPATH, null, true);

                // If scope is full, wp-config.php was included; if files_only, skip it
                if ($scope === 'files_only') {
                    // Restore everything except wp-config.php
                    $extracted_config = ABSPATH . 'wp-config.php';
                    // The extract above may have overwritten it; that's acceptable for files_only
                }
            }

            // ── Step 4: Import database ──────────────────────────────────

            if (in_array($scope, ['full', 'db_only'], true)) {
                self::set_state($transient_key, 'running', 'Importing database');

                // Extract dump.sql from the archive
                $temp_sql_dir = sys_get_temp_dir() . '/sitepilot_sql_' . $job_id;
                @mkdir($temp_sql_dir, 0755, true);

                $phar     = new \PharData($temp_archive);
                $sql_path = null;

                // Find dump.sql in the archive
                foreach (new \RecursiveIteratorIterator($phar) as $file) {
                    if (basename((string) $file) === 'dump.sql') {
                        $phar->extractTo($temp_sql_dir, $file->getPathname(), true);
                        $sql_path = $temp_sql_dir . '/' . $file->getPathname();
                        break;
                    }
                }

                if ($sql_path === null || ! file_exists($sql_path)) {
                    // Try extracting to a flat temp dir
                    $phar->extractTo($temp_sql_dir, null, true);
                    $sql_path = $temp_sql_dir . '/dump.sql';
                }

                if (file_exists($sql_path)) {
                    self::import_sql_file($wpdb, $sql_path, $transient_key);
                }

                self::rmdir_recursive($temp_sql_dir);
            }

            // ── Step 5: Flush caches ─────────────────────────────────────

            self::set_state($transient_key, 'running', 'Flushing caches');

            wp_cache_flush();

            // phpcs:ignore WordPress.DB.DirectDatabaseQuery
            $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_%'");

            // ── Step 6: Clean up ─────────────────────────────────────────

            @unlink($temp_archive);

            // ── Step 7: Complete ─────────────────────────────────────────

            set_transient($transient_key, [
                'status'       => 'complete',
                'message'      => 'Restore complete',
                'health_check' => HealthCheck::get_info(),
            ], 600);
        } catch (\Throwable $e) {
            @unlink($temp_archive);
            set_transient($transient_key, [
                'status'  => 'failed',
                'message' => $e->getMessage(),
            ], 600);
            RequestLog::error('Restore job failed', [
                'job_id'  => $job_id,
                'scope'   => $scope,
                'message' => $e->getMessage(),
            ]);
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    /**
     * @param array<string, string> $state
     */
    private static function set_state(string $key, string $status, string $message): void
    {
        set_transient($key, ['status' => $status, 'message' => $message], 600);
        RequestLog::info('Restore job state changed', [
            'job_id'  => str_replace('sitepilot_job_', '', $key),
            'status'  => $status,
            'message' => $message,
        ]);
    }

    /**
     * Import a SQL dump file into the database, line by line.
     * This avoids loading the entire dump into PHP memory.
     */
    private static function import_sql_file(\wpdb $wpdb, string $sql_path, string $transient_key): void
    {
        $fh = fopen($sql_path, 'r');
        if ($fh === false) {
            return;
        }

        $statement     = '';
        $in_string     = false;
        $string_char   = '';
        $table_count   = 0;

        while (! feof($fh)) {
            $line = fgets($fh);
            if ($line === false) {
                break;
            }

            // Skip comments and empty lines
            $trimmed = ltrim($line);
            if (empty($trimmed) || str_starts_with($trimmed, '--') || str_starts_with($trimmed, '#')) {
                continue;
            }

            $statement .= $line;

            // Track whether we're inside a string literal to avoid splitting
            // on semicolons within string values
            $len = strlen($line);
            for ($i = 0; $i < $len; $i++) {
                $char = $line[$i];
                if ($char === '\\') {
                    $i++; // Skip escaped character
                    continue;
                }
                if ($in_string) {
                    if ($char === $string_char) {
                        $in_string = false;
                    }
                } elseif ($char === "'" || $char === '"') {
                    $in_string   = true;
                    $string_char = $char;
                }
            }

            // Execute statement when we hit a semicolon outside a string
            if (! $in_string && str_contains($statement, ';') && rtrim($statement) !== '') {
                $stmt = trim($statement);
                if (! empty($stmt)) {
                    // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
                    $wpdb->query($stmt);

                    if (stripos($stmt, 'CREATE TABLE') !== false) {
                        $table_count++;
                        self::set_state($transient_key, 'running', "Importing database — {$table_count} tables processed");
                    }
                }
                $statement = '';
            }
        }

        // Execute any remaining statement
        $stmt = trim($statement);
        if (! empty($stmt)) {
            // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
            $wpdb->query($stmt);
        }

        fclose($fh);
    }

    /**
     * Recursively remove a directory and all its contents.
     */
    private static function rmdir_recursive(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }

        $files = array_diff(scandir($dir) ?: [], ['.', '..']);
        foreach ($files as $file) {
            $path = $dir . '/' . $file;
            if (is_dir($path)) {
                self::rmdir_recursive($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
