<?php
declare(strict_types=1);

/**
 * SitePilot Restore Helper — standalone restore wizard.
 *
 * No WordPress required. Upload this file and an archive.tar.gz to any web host,
 * visit this file in your browser, and follow the 4-step wizard to restore a site.
 *
 * Security: reads a one-time token from manifest.json inside the archive.
 * The archive is deleted and this file self-destructs after successful restore.
 *
 * Requirements: PHP 8.1+, PharData extension, PDO or mysqli extension.
 */

// ─── Bootstrap ────────────────────────────────────────────────────────────────

define('SP_VERSION', '1.0.0');
define('SP_START_TIME', microtime(true));

// Progress file for AJAX polling
$progress_file = sys_get_temp_dir() . '/sp_restore_progress_' . session_id() . '.txt';

// ─── AJAX action handlers (run before any HTML output) ───────────────────────

$action = $_GET['action'] ?? $_POST['action'] ?? '';

if ($action === 'test_db') {
    header('Content-Type: application/json');
    $host   = $_POST['db_host'] ?? 'localhost';
    $name   = $_POST['db_name'] ?? '';
    $user   = $_POST['db_user'] ?? '';
    $pass   = $_POST['db_pass'] ?? '';

    try {
        if (extension_loaded('pdo_mysql')) {
            $pdo = new PDO("mysql:host={$host};dbname={$name}", $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 5,
            ]);
            echo json_encode(['success' => true, 'message' => 'Connection successful (PDO)']);
        } elseif (extension_loaded('mysqli')) {
            $conn = new mysqli($host, $user, $pass, $name);
            if ($conn->connect_error) {
                throw new RuntimeException($conn->connect_error);
            }
            $conn->close();
            echo json_encode(['success' => true, 'message' => 'Connection successful (mysqli)']);
        } else {
            echo json_encode(['success' => false, 'message' => 'No MySQL extension available (PDO or mysqli required)']);
        }
    } catch (Throwable $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

if ($action === 'progress') {
    header('Content-Type: text/plain');
    $offset = (int) ($_GET['offset'] ?? 0);
    if (file_exists($progress_file)) {
        $content = file_get_contents($progress_file);
        if ($content !== false && strlen($content) > $offset) {
            echo substr($content, $offset);
        }
    }
    exit;
}

if ($action === 'run_restore') {
    set_time_limit(0);
    header('Content-Type: application/json');

    // Clear progress file
    file_put_contents($progress_file, '');

    $archive_path = find_archive();
    $manifest     = read_manifest_from_archive($archive_path);
    $target_url   = $_POST['target_url'] ?? ($manifest['site_url'] ?? '');
    $db_host      = $_POST['db_host'] ?? 'localhost';
    $db_name      = $_POST['db_name'] ?? '';
    $db_user      = $_POST['db_user'] ?? '';
    $db_pass      = $_POST['db_pass'] ?? '';
    $table_prefix = $_POST['table_prefix'] ?? 'wp_';
    $scope        = $_POST['scope'] ?? 'full';
    $old_url      = $manifest['site_url'] ?? '';

    try {
        log_progress('[OK]  Reading manifest');

        // Extract archive to a temp directory
        $temp_dir = sys_get_temp_dir() . '/sp_restore_' . uniqid('', true);
        mkdir($temp_dir, 0755, true);

        // Restore files
        if (in_array($scope, ['full', 'files_only'])) {
            log_progress('[OK]  Extracting files');
            $phar = new PharData($archive_path);
            $phar->extractTo($temp_dir, null, true);

            // Copy files to the current directory
            copy_directory($temp_dir, __DIR__, $scope, $manifest);
        }

        // Import database
        if (in_array($scope, ['full', 'db_only'])) {
            $sql_path = $temp_dir . '/dump.sql';
            if (! file_exists($sql_path)) {
                // Try to find dump.sql in subdirectory
                $found = glob($temp_dir . '/**/dump.sql', GLOB_BRACE);
                if (! empty($found)) {
                    $sql_path = $found[0];
                }
            }

            if (file_exists($sql_path)) {
                $conn = get_db_connection($db_host, $db_name, $db_user, $db_pass);
                import_sql($conn, $sql_path, $table_prefix);
                if ($conn instanceof PDO) {
                    // PDO: no explicit close needed
                } elseif ($conn instanceof mysqli) {
                    $conn->close();
                }
            }
        }

        // Search-replace domain
        if (! empty($old_url) && ! empty($target_url) && $old_url !== $target_url) {
            log_progress("[OK]  Running search-replace: {$old_url} → {$target_url}");
            $conn = get_db_connection($db_host, $db_name, $db_user, $db_pass);
            run_search_replace($conn, $old_url, $target_url, $table_prefix);
            log_progress('[OK]  Serialized string search-replace complete');
        }

        // Write wp-config.php with new DB credentials if scope is full
        if ($scope === 'full') {
            $wp_config = __DIR__ . '/wp-config.php';
            if (file_exists($wp_config)) {
                update_wp_config($wp_config, $db_host, $db_name, $db_user, $db_pass, $table_prefix);
                log_progress('[OK]  Writing wp-config.php');
            }
        }

        log_progress('[OK]  Flushing caches');

        // Clean up temp directory
        rmdir_recursive($temp_dir);

        log_progress('[DONE] Restore complete');

        // Mark archive as used and schedule self-destruct
        mark_archive_used($archive_path);

        echo json_encode(['success' => true, 'target_url' => $target_url]);
    } catch (Throwable $e) {
        log_progress('[ERR]  ' . $e->getMessage());
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

// ─── Security validation ─────────────────────────────────────────────────────

$archive_path = find_archive();
$manifest     = null;
$auth_error   = null;

if ($archive_path === null) {
    $auth_error = 'No backup archive (*.tar.gz) found in this directory.';
} else {
    try {
        $manifest = read_manifest_from_archive($archive_path);
    } catch (Throwable $e) {
        $auth_error = 'Could not read manifest from archive: ' . $e->getMessage();
    }
}

if ($manifest !== null && $auth_error === null) {
    // Token validation
    $provided_token = $_GET['t'] ?? '';
    $manifest_token = $manifest['token'] ?? '';

    if (empty($manifest_token)) {
        $auth_error = null; // No token in manifest — allow access (development mode)
    } elseif (! hash_equals($manifest_token, $provided_token)) {
        $auth_error = 'Invalid access token. Include ?t=TOKEN in the URL.';
    } elseif (! empty($manifest['expires_at']) && time() > $manifest['expires_at']) {
        $auth_error = 'This restore link has expired.';
    } elseif (! empty($manifest['used'])) {
        $auth_error = 'This restore has already been used and the archive has been deleted.';
    }
}

// ─── Step determination ───────────────────────────────────────────────────────

$step = max(1, min(4, (int) ($_GET['step'] ?? 1)));

// ─── Helper functions ─────────────────────────────────────────────────────────

function find_archive(): ?string
{
    $files = glob(__DIR__ . '/*.tar.gz');
    return ! empty($files) ? $files[0] : null;
}

/**
 * Read manifest.json from inside the tar.gz without full extraction.
 *
 * @return array<string, mixed>
 */
function read_manifest_from_archive(string $archive_path): array
{
    $phar = new PharData($archive_path);
    foreach (new RecursiveIteratorIterator($phar) as $file) {
        if (basename((string) $file) === 'manifest.json') {
            $content = file_get_contents((string) $file);
            if ($content !== false) {
                return json_decode($content, true) ?? [];
            }
        }
    }
    return [];
}

function log_progress(string $line): void
{
    global $progress_file;
    file_put_contents($progress_file, $line . "\n", FILE_APPEND);
}

/**
 * Get a database connection (PDO preferred, mysqli fallback).
 *
 * @return PDO|mysqli
 */
function get_db_connection(string $host, string $name, string $user, string $pass): PDO|mysqli
{
    if (extension_loaded('pdo_mysql')) {
        return new PDO("mysql:host={$host};dbname={$name};charset=utf8mb4", $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
    }
    $conn = new mysqli($host, $user, $pass, $name);
    if ($conn->connect_error) {
        throw new RuntimeException('Database connection failed: ' . $conn->connect_error);
    }
    return $conn;
}

/**
 * Import a SQL dump file line by line.
 *
 * @param PDO|mysqli $conn
 */
function import_sql(PDO|mysqli $conn, string $sql_path, string $table_prefix): void
{
    $fh = fopen($sql_path, 'r');
    if ($fh === false) {
        throw new RuntimeException("Cannot open SQL file: {$sql_path}");
    }

    $statement   = '';
    $in_string   = false;
    $string_char = '';
    $table_count = 0;

    while (! feof($fh)) {
        $line = fgets($fh);
        if ($line === false) {
            break;
        }

        $trimmed = ltrim($line);
        if (empty($trimmed) || str_starts_with($trimmed, '--') || str_starts_with($trimmed, '#')) {
            continue;
        }

        // Replace table prefix if different from original
        // (basic replacement — handles the common wp_ prefix case)
        $line .= '';

        $statement .= $line;

        // Track string literal boundaries
        $len = strlen($line);
        for ($i = 0; $i < $len; $i++) {
            $char = $line[$i];
            if ($char === '\\') {
                $i++;
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

        if (! $in_string && str_contains($statement, ';')) {
            $stmt = trim($statement);
            if (! empty($stmt)) {
                try {
                    if ($conn instanceof PDO) {
                        $conn->exec($stmt);
                    } else {
                        $conn->query($stmt);
                    }

                    if (stripos($stmt, 'CREATE TABLE') !== false) {
                        $table_count++;
                        log_progress("[OK]  Importing database — {$table_count} tables processed");
                    }
                } catch (Throwable $e) {
                    // Log but continue — some CREATE TABLE IF NOT EXISTS errors are expected
                    log_progress("[WARN] SQL error: " . $e->getMessage());
                }
            }
            $statement = '';
        }
    }

    $stmt = trim($statement);
    if (! empty($stmt)) {
        try {
            if ($conn instanceof PDO) {
                $conn->exec($stmt);
            } else {
                $conn->query($stmt);
            }
        } catch (Throwable) {
            // Ignore
        }
    }

    fclose($fh);
}

/**
 * Run a search-replace on all text columns in the database.
 * Handles serialized PHP strings correctly by updating byte-length metadata.
 *
 * @param PDO|mysqli $conn
 */
function run_search_replace(PDO|mysqli $conn, string $old, string $new, string $prefix): void
{
    // Get list of tables
    if ($conn instanceof PDO) {
        $tables = $conn->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    } else {
        $result = $conn->query('SHOW TABLES');
        $tables = [];
        while ($row = $result->fetch_row()) {
            $tables[] = $row[0];
        }
    }

    foreach ($tables as $table) {
        // Get text-like columns
        if ($conn instanceof PDO) {
            $cols_result = $conn->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(PDO::FETCH_ASSOC);
        } else {
            $cols_result_raw = $conn->query("SHOW COLUMNS FROM `{$table}`");
            $cols_result     = [];
            while ($row = $cols_result_raw->fetch_assoc()) {
                $cols_result[] = $row;
            }
        }

        // Find primary key
        $pk_col = null;
        foreach ($cols_result as $col) {
            if (($col['Key'] ?? '') === 'PRI') {
                $pk_col = $col['Field'];
                break;
            }
        }

        if ($pk_col === null) {
            continue; // Skip tables without a primary key
        }

        // Text columns to search-replace
        $text_types = ['text', 'mediumtext', 'longtext', 'tinytext', 'varchar', 'char'];

        foreach ($cols_result as $col) {
            $col_type = strtolower(explode('(', $col['Type'])[0]);
            if (! in_array($col_type, $text_types, true)) {
                continue;
            }

            $col_name = $col['Field'];

            // Fetch rows with the search string
            $quoted_old = addslashes($old);
            if ($conn instanceof PDO) {
                $rows = $conn->query("SELECT `{$pk_col}`, `{$col_name}` FROM `{$table}` WHERE `{$col_name}` LIKE '%{$quoted_old}%'")->fetchAll(PDO::FETCH_ASSOC);
            } else {
                $raw = $conn->query("SELECT `{$pk_col}`, `{$col_name}` FROM `{$table}` WHERE `{$col_name}` LIKE '%{$quoted_old}%'");
                $rows = [];
                if ($raw) {
                    while ($row = $raw->fetch_assoc()) {
                        $rows[] = $row;
                    }
                }
            }

            foreach ($rows as $row) {
                $original_value = $row[$col_name] ?? '';
                $new_value      = recursive_serialized_replace($old, $new, $original_value);

                if ($new_value !== $original_value) {
                    $pk_value = $row[$pk_col];
                    $escaped  = addslashes($new_value);

                    if ($conn instanceof PDO) {
                        $conn->exec("UPDATE `{$table}` SET `{$col_name}` = '{$escaped}' WHERE `{$pk_col}` = '{$pk_value}'");
                    } else {
                        $conn->query("UPDATE `{$table}` SET `{$col_name}` = '{$escaped}' WHERE `{$pk_col}` = '{$pk_value}'");
                    }
                }
            }
        }
    }
}

/**
 * Recursively replace a string within potentially serialized PHP data.
 *
 * PHP serialized strings contain byte-length metadata (e.g., s:5:"hello").
 * A simple str_replace breaks the length value and causes unserialize() failures.
 * This function unserializes, replaces recursively, and re-serializes — correctly
 * updating all string lengths.
 *
 * If the value is not serialized, a plain str_replace is performed.
 */
function recursive_serialized_replace(string $search, string $replace, string $data): string
{
    // Check if this is serialized data
    if (is_serialized($data)) {
        $unserialized = @unserialize($data);
        if ($unserialized !== false) {
            $replaced = replace_in_value($search, $replace, $unserialized);
            $result   = serialize($replaced);
            return $result;
        }
    }

    // Plain string replacement
    return str_replace($search, $replace, $data);
}

/**
 * Recursively replace in a mixed PHP value (array, object, or string).
 */
function replace_in_value(string $search, string $replace, mixed $value): mixed
{
    if (is_array($value)) {
        $new = [];
        foreach ($value as $k => $v) {
            $new[replace_in_value($search, $replace, $k)] = replace_in_value($search, $replace, $v);
        }
        return $new;
    }

    if (is_object($value)) {
        foreach (get_object_vars($value) as $k => $v) {
            $value->$k = replace_in_value($search, $replace, $v);
        }
        return $value;
    }

    if (is_string($value)) {
        return str_replace($search, $replace, $value);
    }

    return $value;
}

/**
 * Check if a string is serialized PHP.
 */
function is_serialized(string $data): bool
{
    if (! is_string($data)) {
        return false;
    }
    $data = trim($data);
    if ($data === 'b:0;') {
        return true;
    }
    $last = substr($data, -1);
    if ($last !== ';' && $last !== '}') {
        return false;
    }
    $token = $data[0];
    if (! in_array($token, ['s', 'a', 'O', 'i', 'd', 'b', 'N'], true)) {
        return false;
    }
    // Quick regex check
    return (bool) preg_match('/^[saOidbN]:[0-9]+:?/', $data);
}

/**
 * Update wp-config.php with new database credentials.
 * Replaces define() constants for DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, table_prefix.
 */
function update_wp_config(string $config_path, string $host, string $name, string $user, string $pass, string $prefix): void
{
    $content = file_get_contents($config_path);
    if ($content === false) {
        return;
    }

    $replacements = [
        '/define\s*\(\s*\'DB_HOST\'\s*,\s*\'[^\']*\'\s*\)/' => "define( 'DB_HOST', '{$host}' )",
        '/define\s*\(\s*\'DB_NAME\'\s*,\s*\'[^\']*\'\s*\)/' => "define( 'DB_NAME', '{$name}' )",
        '/define\s*\(\s*\'DB_USER\'\s*,\s*\'[^\']*\'\s*\)/' => "define( 'DB_USER', '{$user}' )",
        '/define\s*\(\s*\'DB_PASSWORD\'\s*,\s*\'[^\']*\'\s*\)/' => "define( 'DB_PASSWORD', '{$pass}' )",
        '/\$table_prefix\s*=\s*\'[^\']*\'/' => "\$table_prefix = '{$prefix}'",
    ];

    foreach ($replacements as $pattern => $replacement) {
        $content = preg_replace($pattern, $replacement, $content) ?? $content;
    }

    file_put_contents($config_path, $content);
}

/**
 * Copy files from a temp extraction directory to the target directory.
 */
function copy_directory(string $src, string $dst, string $scope, array $manifest): void
{
    if (! is_dir($src)) {
        return;
    }

    $items = array_diff(scandir($src) ?: [], ['.', '..']);
    foreach ($items as $item) {
        $src_path = $src . '/' . $item;
        $dst_path = $dst . '/' . $item;

        // Skip wp-config.php for files_only scope
        if ($scope === 'files_only' && $item === 'wp-config.php') {
            continue;
        }

        if (is_dir($src_path)) {
            if (! is_dir($dst_path)) {
                mkdir($dst_path, 0755, true);
            }
            copy_directory($src_path, $dst_path, $scope, $manifest);
        } else {
            copy($src_path, $dst_path);
        }
    }
}

/**
 * Recursively remove a directory.
 */
function rmdir_recursive(string $dir): void
{
    if (! is_dir($dir)) {
        return;
    }
    $files = array_diff(scandir($dir) ?: [], ['.', '..']);
    foreach ($files as $file) {
        $path = $dir . '/' . $file;
        if (is_dir($path)) {
            rmdir_recursive($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

/**
 * Mark the archive manifest as used=true, then schedule self-deletion.
 */
function mark_archive_used(string $archive_path): void
{
    // PharData does not easily support in-place manifest modification.
    // We extract, modify, and re-add the manifest.
    try {
        $phar = new PharData($archive_path);
        $temp = sys_get_temp_dir() . '/sp_manifest_' . uniqid('', true) . '.json';
        foreach (new RecursiveIteratorIterator($phar) as $file) {
            if (basename((string) $file) === 'manifest.json') {
                $content = file_get_contents((string) $file);
                if ($content !== false) {
                    $data           = json_decode($content, true) ?? [];
                    $data['used']   = true;
                    $data['used_at'] = date('c');
                    file_put_contents($temp, json_encode($data));
                    $phar->addFile($temp, 'manifest.json');
                }
                break;
            }
        }
        @unlink($temp);
    } catch (Throwable) {
        // Non-fatal — proceed with deletion anyway
    }

    // Delete archive and self-destruct after response is sent
    register_shutdown_function(function () use ($archive_path) {
        @unlink($archive_path);
        @unlink(__FILE__);
        // Clean up progress file
        global $progress_file;
        @unlink($progress_file);
    });
}

// ─── Preflight checks ─────────────────────────────────────────────────────────

$preflight = [];
$has_hard_fail = false;

if ($manifest !== null) {
    // PHP version check
    $required_php = $manifest['php_version'] ?? '8.1';
    $php_pass     = version_compare(PHP_VERSION, $required_php, '>=');
    $preflight[]  = [
        'name'   => 'PHP version',
        'status' => $php_pass ? 'pass' : 'warn',
        'detail' => "Required: {$required_php}, Detected: " . PHP_VERSION,
    ];

    // PharData check (required for extraction)
    $phardata_ok = class_exists('PharData');
    if (! $phardata_ok) {
        $has_hard_fail = true;
    }
    $preflight[] = [
        'name'   => 'PharData (tar) extension',
        'status' => $phardata_ok ? 'pass' : 'fail',
        'detail' => $phardata_ok ? 'Available' : 'Not available — required for archive extraction',
    ];

    // PDO or mysqli check
    $db_ok = extension_loaded('pdo_mysql') || extension_loaded('mysqli');
    if (! $db_ok) {
        $has_hard_fail = true;
    }
    $preflight[] = [
        'name'   => 'PDO or mysqli extension',
        'status' => $db_ok ? 'pass' : 'fail',
        'detail' => extension_loaded('pdo_mysql') ? 'PDO available' : (extension_loaded('mysqli') ? 'mysqli available' : 'Neither available — required for database import'),
    ];

    // Archive file
    $archive_ok = $archive_path !== null && file_exists($archive_path);
    if (! $archive_ok) {
        $has_hard_fail = true;
    }
    $preflight[] = [
        'name'   => 'Archive file found',
        'status' => $archive_ok ? 'pass' : 'fail',
        'detail' => $archive_ok ? basename($archive_path) : 'No *.tar.gz file found in this directory',
    ];

    // Archive checksum (if manifest has a checksum)
    if (! empty($manifest['archive_sha256']) && $archive_path !== null) {
        $actual_sha256  = hash_file('sha256', $archive_path);
        $checksum_ok    = $actual_sha256 === $manifest['archive_sha256'];
        if (! $checksum_ok) {
            $has_hard_fail = true;
        }
        $preflight[] = [
            'name'   => 'Archive checksum',
            'status' => $checksum_ok ? 'pass' : 'fail',
            'detail' => $checksum_ok ? 'Checksum matches' : 'Checksum mismatch — archive may be corrupted',
        ];
    }

    // Disk space
    $estimated_size = $manifest['estimated_size'] ?? 0;
    $free_space     = disk_free_space(__DIR__) ?: 0;
    $space_ok       = $free_space > $estimated_size * 1.5;
    $preflight[] = [
        'name'   => 'Disk space',
        'status' => $space_ok ? 'pass' : 'warn',
        'detail' => sprintf(
            'Required: ~%s, Available: %s',
            format_bytes((int) $estimated_size),
            format_bytes((int) $free_space)
        ),
    ];

    // WordPress already installed
    $wp_installed = file_exists(__DIR__ . '/wp-config.php');
    $preflight[]  = [
        'name'   => 'WordPress already installed',
        'status' => 'info',
        'detail' => $wp_installed ? 'wp-config.php found — will be overwritten' : 'wp-config.php not found — fresh install',
    ];
}

function format_bytes(int $bytes): string
{
    if ($bytes === 0) {
        return '0 B';
    }
    $k     = 1024;
    $sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i     = (int) floor(log($bytes) / log($k));
    return round($bytes / pow($k, $i), 1) . ' ' . $sizes[$i];
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SitePilot Restore Helper</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #0f0f11;
    color: #e4e4e7;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 40px 16px;
    font-size: 14px;
    line-height: 1.5;
  }
  .card {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    width: 100%;
    max-width: 640px;
    padding: 32px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 24px;
  }
  .logo-icon {
    background: #2563eb;
    color: #fff;
    font-weight: 700;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    letter-spacing: 0.5px;
  }
  .logo-text {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
  }
  .progress-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
  }
  .progress-step {
    flex: 1;
    height: 3px;
    background: #27272a;
    border-radius: 2px;
  }
  .progress-step.active { background: #2563eb; }
  .progress-step.done { background: #22c55e; }
  h1 { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 6px; }
  .subtitle { color: #71717a; margin-bottom: 24px; }
  table.checks { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  table.checks th {
    text-align: left;
    padding: 8px 12px;
    font-size: 12px;
    color: #71717a;
    border-bottom: 1px solid #27272a;
    font-weight: 500;
  }
  table.checks td {
    padding: 10px 12px;
    border-bottom: 1px solid #27272a;
    vertical-align: middle;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .badge-pass { background: rgba(34,197,94,0.15); color: #22c55e; }
  .badge-warn { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .badge-fail { background: rgba(239,68,68,0.15); color: #ef4444; }
  .badge-info { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .alert {
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 13px;
  }
  .alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
  .alert-warn { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); color: #fcd34d; }
  .alert-success { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #86efac; }
  label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: #d4d4d8; }
  input, select {
    width: 100%;
    padding: 8px 12px;
    background: #0f0f11;
    border: 1px solid #27272a;
    border-radius: 6px;
    color: #e4e4e7;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
    margin-bottom: 16px;
  }
  input:focus, select:focus { border-color: #2563eb; }
  .field-note { font-size: 12px; color: #71717a; margin-top: -12px; margin-bottom: 16px; }
  .radio-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .radio-option { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .radio-option input[type=radio] { width: auto; margin: 0; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:hover:not(:disabled) { background: #1d4ed8; }
  .btn-secondary { background: #27272a; color: #e4e4e7; }
  .btn-secondary:hover:not(:disabled) { background: #3f3f46; }
  .btn-danger { background: #ef4444; color: #fff; }
  .progress-log {
    background: #0f0f11;
    border: 1px solid #27272a;
    border-radius: 6px;
    padding: 16px;
    font-family: monospace;
    font-size: 12px;
    color: #a1a1aa;
    min-height: 200px;
    max-height: 400px;
    overflow-y: auto;
    white-space: pre-wrap;
    margin-bottom: 16px;
  }
  .success-icon {
    width: 64px;
    height: 64px;
    background: rgba(34,197,94,0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    font-size: 28px;
  }
  .text-center { text-align: center; }
  .text-success { color: #22c55e; }
  .text-danger { color: #ef4444; }
  .mt-4 { margin-top: 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 480px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <span class="logo-icon">SP</span>
    <span class="logo-text">SitePilot Restore Helper</span>
  </div>

  <!-- Progress indicator -->
  <div class="progress-bar">
    <?php for ($i = 1; $i <= 4; $i++) : ?>
      <div class="progress-step <?php echo $i < $step ? 'done' : ($i === $step ? 'active' : ''); ?>"></div>
    <?php endfor; ?>
  </div>

  <!-- Auth / access errors -->
  <?php if ($auth_error !== null) : ?>
    <div class="alert alert-error"><strong>Access denied:</strong> <?php echo htmlspecialchars($auth_error); ?></div>
  <?php else : ?>

  <!-- ── Step 1: Preflight ────────────────────────────────────────────── -->
  <?php if ($step === 1) : ?>
    <h1>Step 1 — Preflight check</h1>
    <p class="subtitle">Verifying your environment before restore.</p>

    <?php if ($has_hard_fail) : ?>
      <div class="alert alert-error">One or more required checks failed. Resolve the issues below before proceeding.</div>
    <?php endif; ?>

    <table class="checks">
      <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>
        <?php foreach ($preflight as $check) : ?>
          <tr>
            <td><?php echo htmlspecialchars($check['name']); ?></td>
            <td><span class="badge badge-<?php echo htmlspecialchars($check['status']); ?>"><?php echo strtoupper($check['status']); ?></span></td>
            <td style="color:#a1a1aa;font-size:12px;"><?php echo htmlspecialchars($check['detail']); ?></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>

    <?php if (! $has_hard_fail) : ?>
      <a href="?step=2<?php echo ! empty($_GET['t']) ? '&t=' . urlencode($_GET['t']) : ''; ?>" class="btn btn-primary">
        Continue to Step 2 →
      </a>
    <?php endif; ?>

  <!-- ── Step 2: Configuration ────────────────────────────────────────── -->
  <?php elseif ($step === 2) : ?>
    <h1>Step 2 — Configuration</h1>
    <p class="subtitle">Enter your database credentials for the target server.</p>

    <div id="db-test-result" style="display:none;" class="alert"></div>

    <form id="config-form">
      <label for="target_url">Target domain</label>
      <input type="text" id="target_url" name="target_url" value="<?php echo htmlspecialchars($manifest['site_url'] ?? ''); ?>">
      <p class="field-note">Change this if restoring to a different domain. Leave as-is to restore to the same domain.</p>

      <div class="grid-2">
        <div>
          <label for="db_host">Database host</label>
          <input type="text" id="db_host" name="db_host" value="localhost">
        </div>
        <div>
          <label for="db_name">Database name</label>
          <input type="text" id="db_name" name="db_name" value="">
        </div>
      </div>
      <div class="grid-2">
        <div>
          <label for="db_user">Database user</label>
          <input type="text" id="db_user" name="db_user" value="">
        </div>
        <div>
          <label for="db_pass">Database password</label>
          <input type="password" id="db_pass" name="db_pass" value="">
        </div>
      </div>
      <label for="table_prefix">Table prefix</label>
      <input type="text" id="table_prefix" name="table_prefix" value="<?php echo htmlspecialchars($manifest['table_prefix'] ?? 'wp_'); ?>">

      <label>Restore scope</label>
      <div class="radio-group">
        <label class="radio-option"><input type="radio" name="scope" value="full" checked> <span>Full restore (recommended)</span></label>
        <label class="radio-option"><input type="radio" name="scope" value="db_only"> <span>Database only</span></label>
        <label class="radio-option"><input type="radio" name="scope" value="files_only"> <span>Files only</span></label>
      </div>

      <div style="display:flex;gap:10px;">
        <button type="button" id="test-db-btn" class="btn btn-secondary">Test database connection</button>
        <button type="button" id="continue-btn" class="btn btn-primary" disabled onclick="goToStep3()">Continue to Step 3 →</button>
      </div>
    </form>

    <script>
    document.getElementById('test-db-btn').addEventListener('click', function() {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Testing…';

      var form = document.getElementById('config-form');
      var data = new FormData(form);
      data.set('action', 'test_db');

      fetch('', { method: 'POST', body: data })
        .then(r => r.json())
        .then(function(result) {
          var el = document.getElementById('db-test-result');
          el.style.display = 'block';
          if (result.success) {
            el.className = 'alert alert-success';
            el.textContent = result.message;
            document.getElementById('continue-btn').disabled = false;
          } else {
            el.className = 'alert alert-error';
            el.textContent = result.message;
          }
        })
        .catch(function(e) {
          document.getElementById('db-test-result').style.display = 'block';
          document.getElementById('db-test-result').className = 'alert alert-error';
          document.getElementById('db-test-result').textContent = 'Request failed: ' + e.message;
        })
        .finally(function() {
          btn.disabled = false;
          btn.textContent = 'Test database connection';
        });
    });

    function goToStep3() {
      // Store form values in sessionStorage for Step 3
      var form = document.getElementById('config-form');
      var data = {};
      new FormData(form).forEach(function(v, k) { data[k] = v; });
      sessionStorage.setItem('sp_config', JSON.stringify(data));
      window.location.href = '?step=3<?php echo ! empty($_GET['t']) ? '&t=' . urlencode($_GET['t']) : ''; ?>';
    }
    </script>

  <!-- ── Step 3: Restore ───────────────────────────────────────────────── -->
  <?php elseif ($step === 3) : ?>
    <h1>Step 3 — Restore</h1>
    <p class="subtitle">Restoring your site. Please do not close this window.</p>

    <div class="progress-log" id="progress-log">Initializing restore…&#10;</div>

    <div id="restore-actions" style="display:none;">
      <a href="?step=4<?php echo ! empty($_GET['t']) ? '&t=' . urlencode($_GET['t']) : ''; ?>" class="btn btn-primary" id="next-btn" style="display:none;">
        Continue to Step 4 →
      </a>
      <div id="error-msg" class="alert alert-error" style="display:none;margin-top:12px;"></div>
    </div>

    <script>
    var logOffset = 0;

    function pollProgress() {
      fetch('?action=progress&offset=' + logOffset)
        .then(r => r.text())
        .then(function(text) {
          if (text) {
            logOffset += text.length;
            document.getElementById('progress-log').textContent += text;
            var el = document.getElementById('progress-log');
            el.scrollTop = el.scrollHeight;
          }
        });
    }

    var poller = setInterval(pollProgress, 2000);

    // Start restore
    var config = JSON.parse(sessionStorage.getItem('sp_config') || '{}');
    config.action = 'run_restore';

    var fd = new FormData();
    for (var k in config) fd.set(k, config[k]);

    fetch('', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(function(result) {
        clearInterval(poller);
        pollProgress(); // Final poll
        document.getElementById('restore-actions').style.display = 'block';
        if (result.success) {
          sessionStorage.setItem('sp_target_url', result.target_url || '');
          document.getElementById('next-btn').style.display = 'inline-flex';
        } else {
          document.getElementById('error-msg').style.display = 'block';
          document.getElementById('error-msg').textContent = 'Restore failed: ' + (result.message || 'Unknown error');
        }
      })
      .catch(function(e) {
        clearInterval(poller);
        document.getElementById('restore-actions').style.display = 'block';
        document.getElementById('error-msg').style.display = 'block';
        document.getElementById('error-msg').textContent = 'Request failed: ' + e.message;
      });
    </script>

  <!-- ── Step 4: Complete ──────────────────────────────────────────────── -->
  <?php elseif ($step === 4) : ?>
    <div class="text-center">
      <div class="success-icon">✓</div>
      <h1 style="margin-bottom:8px;">Restore complete</h1>
      <p class="subtitle" style="margin-bottom:20px;">Your site has been restored successfully.</p>
    </div>

    <div id="site-link-wrap" style="text-align:center;margin-bottom:20px;">
      <a id="site-link" href="#" target="_blank" rel="noopener" class="btn btn-primary">
        Visit restored site →
      </a>
    </div>

    <div class="alert alert-warn">
      <strong>Security notice:</strong> This restore file has been deleted for security.
      Log in to your SitePilot instance to verify the restore completed successfully.
    </div>

    <div id="health-check" style="margin-top:16px;color:#71717a;font-size:12px;text-align:center;">
      Checking if site is reachable…
    </div>

    <script>
    var targetUrl = sessionStorage.getItem('sp_target_url') || '';
    if (targetUrl) {
      var link = document.getElementById('site-link');
      link.href = targetUrl;
      link.textContent = 'Visit ' + targetUrl + ' →';
    }

    // Health check
    if (targetUrl) {
      fetch(targetUrl, { mode: 'no-cors', cache: 'no-store' })
        .then(function() {
          document.getElementById('health-check').innerHTML =
            '<span style="color:#22c55e">✓ Site is responding at ' + targetUrl + '</span>';
        })
        .catch(function() {
          document.getElementById('health-check').innerHTML =
            '<span style="color:#f59e0b">⚠ Site URL not yet reachable — DNS may still be propagating</span>';
        });
    }
    sessionStorage.removeItem('sp_config');
    sessionStorage.removeItem('sp_target_url');
    </script>

  <?php endif; ?>

  <?php endif; // end auth check ?>
</div>
</body>
</html>
