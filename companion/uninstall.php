<?php
declare(strict_types=1);

// Only run uninstall when called through WordPress
if (! defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// Delete all SitePilot options
$sitepilot_options = [
    'sitepilot_token',
    'sitepilot_enabled',
    'sitepilot_last_seen',
    'sitepilot_request_log',
];

foreach ($sitepilot_options as $option) {
    delete_option($option);
}

// Clean up any lingering transients
global $wpdb;
// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE 'sitepilot_job_%'");
