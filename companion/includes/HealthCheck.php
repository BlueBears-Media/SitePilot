<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * HealthCheck — returns environment information about this WordPress site.
 *
 * Used by the /health endpoint and by the admin settings page environment panel.
 */
class HealthCheck
{
    /**
     * Collect all health and environment information.
     *
     * @return array<string, mixed>
     */
    public static function get_info(): array
    {
        $theme         = wp_get_theme();
        $disk_free     = @disk_free_space(ABSPATH);
        $temp_dir      = sys_get_temp_dir();
        $temp_writable = is_writable($temp_dir);

        // Check for PharData availability (needed for tar.gz extraction in Restore.php)
        $phardata_available = class_exists('PharData');

        return [
            'status'              => 'ok',
            'wp_version'          => get_bloginfo('version'),
            'php_version'         => PHP_VERSION,
            'plugin_version'      => SITEPILOT_VERSION,
            'site_url'            => get_site_url(),
            'companion_enabled'   => (bool) get_option('sitepilot_enabled', false),
            'active_theme'        => [
                'name'    => $theme->get('Name'),
                'version' => $theme->get('Version'),
            ],
            'disk_free_bytes'     => $disk_free !== false ? $disk_free : null,
            'temp_dir_writable'   => $temp_writable,
            'phardata_available'  => $phardata_available,
        ];
    }
}
