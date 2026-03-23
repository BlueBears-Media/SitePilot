<?php
declare(strict_types=1);

namespace SitePilot\Admin;

use SitePilot\HealthCheck;

/**
 * SettingsPage — WordPress admin settings UI for the SitePilot Companion.
 *
 * Accessible via Settings → SitePilot in the WordPress admin menu.
 * Uses only WordPress's built-in admin CSS classes — no external dependencies.
 */
class SettingsPage
{
    private const MENU_SLUG   = 'sitepilot-companion';
    private const OPTION_TOKEN   = 'sitepilot_token';
    private const OPTION_ENABLED = 'sitepilot_enabled';

    /**
     * Register the settings page under Settings menu.
     */
    public static function add_menu(): void
    {
        add_options_page(
            'SitePilot Companion',
            'SitePilot',
            'manage_options',
            self::MENU_SLUG,
            [self::class, 'render']
        );
    }

    /**
     * Register settings for the WP Settings API.
     */
    public static function register_settings(): void
    {
        register_setting('sitepilot_settings', self::OPTION_TOKEN);
        register_setting('sitepilot_settings', self::OPTION_ENABLED);
    }

    /**
     * Handle the settings form submission.
     */
    public static function handle_save(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('sitepilot_save_settings');

        $token   = sanitize_text_field($_POST['sitepilot_token'] ?? '');
        $enabled = isset($_POST['sitepilot_enabled']) && $_POST['sitepilot_enabled'] === '1';

        if (! empty($token)) {
            update_option(self::OPTION_TOKEN, $token);
        }

        update_option(self::OPTION_ENABLED, $enabled);

        wp_redirect(admin_url('options-general.php?page=' . self::MENU_SLUG . '&saved=1'));
        exit;
    }

    /**
     * Handle the "Remove SitePilot" button.
     */
    public static function handle_remove(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('sitepilot_remove');

        delete_option(self::OPTION_TOKEN);
        delete_option(self::OPTION_ENABLED);
        delete_option('sitepilot_last_seen');

        // Deactivate the plugin
        deactivate_plugins(SITEPILOT_BASENAME);

        wp_redirect(admin_url('plugins.php?deactivated=1'));
        exit;
    }

    /**
     * Render the settings page.
     */
    public static function render(): void
    {
        require SITEPILOT_DIR . '/admin/views/settings.php';
    }
}
