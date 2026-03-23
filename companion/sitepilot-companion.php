<?php
/**
 * Plugin Name: SitePilot Companion
 * Plugin URI:  https://github.com/sitepilot/sitepilot
 * Description: Connects this WordPress site to a SitePilot instance for automated backups, updates, and monitoring.
 * Version:     1.0.0
 * Requires at least: 6.0
 * Requires PHP: 8.1
 * Author:      SitePilot
 * License:     GPL-2.0+
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

declare(strict_types=1);

// Prevent direct access
if (! defined('ABSPATH')) {
    exit;
}

// Plugin constants
define('SITEPILOT_VERSION', '1.0.0');
define('SITEPILOT_DIR', __DIR__);
define('SITEPILOT_BASENAME', plugin_basename(__FILE__));

// Always-needed: Auth is used by the REST permission callback
require_once SITEPILOT_DIR . '/includes/Auth.php';

// ─── Activation hook ─────────────────────────────────────────────────────────

register_activation_hook(__FILE__, function (): void {
    add_option('sitepilot_token', '');
    add_option('sitepilot_enabled', false);
    add_option('sitepilot_last_seen', '');
});

// ─── Deactivation hook ───────────────────────────────────────────────────────

register_deactivation_hook(__FILE__, function (): void {
    // Intentionally do nothing — preserve config across deactivate/activate cycles.
});

// ─── Bootstrap REST routes (lazy-load heavy classes only when REST API runs) ──

add_action('rest_api_init', function (): void {
    require_once SITEPILOT_DIR . '/includes/HealthCheck.php';
    require_once SITEPILOT_DIR . '/includes/Backup.php';
    require_once SITEPILOT_DIR . '/includes/Updates.php';
    require_once SITEPILOT_DIR . '/includes/Restore.php';
    require_once SITEPILOT_DIR . '/includes/Router.php';
    SitePilot\Router::register_routes();
});

// ─── Bootstrap admin settings page ──────────────────────────────────────────

if (is_admin()) {
    require_once SITEPILOT_DIR . '/admin/SettingsPage.php';
    add_action('admin_menu', [SitePilot\Admin\SettingsPage::class, 'add_menu']);
    add_action('admin_init', [SitePilot\Admin\SettingsPage::class, 'register_settings']);
    add_action('admin_post_sitepilot_save_settings', [SitePilot\Admin\SettingsPage::class, 'handle_save']);
    add_action('admin_post_sitepilot_remove', [SitePilot\Admin\SettingsPage::class, 'handle_remove']);
}

// ─── Background job hooks (lazy-load only when cron fires) ───────────────────

add_action('sitepilot_run_update', function (string $jobId, string $updateType, string $slug): void {
    require_once SITEPILOT_DIR . '/includes/Updates.php';
    SitePilot\Updates::run_update($jobId, $updateType, $slug);
}, 10, 3);

add_action('sitepilot_run_restore', function (string $jobId, string $signedUrl, string $manifest, string $scope): void {
    require_once SITEPILOT_DIR . '/includes/Restore.php';
    SitePilot\Restore::run_restore($jobId, $signedUrl, $manifest, $scope);
}, 10, 4);
