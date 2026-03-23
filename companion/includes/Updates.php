<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * Updates — WordPress update detection and application.
 *
 * Detection uses WordPress's built-in update transients, forcing a fresh
 * check before reading them so results are always current.
 *
 * Application uses WordPress's built-in upgrader classes and runs in a
 * background process to avoid HTTP request timeouts.
 *
 * Background execution strategy:
 *   1. Primary: popen() to immediately fire wp-cron.php as a detached process.
 *      This runs independently of site traffic and guarantees near-immediate
 *      execution — critical for staging sites with no visitor traffic.
 *   2. Fallback: wp_schedule_single_event() if popen() is disabled (some
 *      shared hosts disable it as a security measure). WP-cron fires on the
 *      next site visit, which may be delayed on low-traffic sites.
 */
class Updates
{
    /**
     * Check for available updates.
     * Forces a fresh check before reading transients.
     *
     * @return array<string, mixed>
     */
    public static function check(): array
    {
        // Force WordPress to re-check for updates now
        wp_version_check();
        wp_update_plugins();
        wp_update_themes();

        $core_update    = self::get_core_update();
        $plugin_updates = self::get_plugin_updates();
        $theme_updates  = self::get_theme_updates();

        return [
            'core'    => $core_update,
            'plugins' => $plugin_updates,
            'themes'  => $theme_updates,
        ];
    }

    /**
     * Handle POST /apply-update — schedule the update and return immediately.
     */
    public static function handle_apply(\WP_REST_Request $request): \WP_REST_Response
    {
        $update_type = $request->get_param('update_type') ?? '';
        $slug        = $request->get_param('slug') ?? '';

        if (! in_array($update_type, ['core', 'plugin', 'theme'], true)) {
            return new \WP_REST_Response(['error' => 'Invalid update_type'], 400);
        }

        $job_id = wp_generate_uuid4();

        // Store initial state as a transient (10 minute TTL)
        set_transient('sitepilot_job_' . $job_id, [
            'status'  => 'running',
            'message' => 'Starting update',
        ], 600);

        // Register the cron action hook before scheduling
        add_action('sitepilot_run_update', [self::class, 'run_update'], 10, 3);

        // Schedule the actual update work
        wp_schedule_single_event(time(), 'sitepilot_run_update', [$job_id, $update_type, $slug]);

        // Primary strategy: immediately fire wp-cron.php via popen() so the
        // update runs right away, independent of site traffic.
        if (function_exists('popen')) {
            $php_binary = PHP_BINARY ?: 'php';
            $cron_path  = ABSPATH . 'wp-cron.php';
            if (file_exists($cron_path)) {
                // Detach: > /dev/null 2>&1 & ensures the process runs independently
                @popen("{$php_binary} {$cron_path} > /dev/null 2>&1 &", 'r');
            }
        }
        // Fallback (popen disabled): wp_schedule_single_event above will fire
        // on the next site visit. This is less reliable but still correct.

        return new \WP_REST_Response([
            'job_id' => $job_id,
            'status' => 'started',
        ], 200);
    }

    /**
     * Handle GET /update-status
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
     * Run the actual update. This is called by the 'sitepilot_run_update' WP-cron action.
     *
     * @param string $job_id
     * @param string $update_type 'core' | 'plugin' | 'theme'
     * @param string $slug        Plugin file or theme slug (empty for core)
     */
    public static function run_update(string $job_id, string $update_type, string $slug): void
    {
        $transient_key = 'sitepilot_job_' . $job_id;

        self::update_job_state($transient_key, 'running', 'Loading update classes');

        try {
            switch ($update_type) {
                case 'core':
                    self::update_core($transient_key);
                    break;
                case 'plugin':
                    self::update_plugin($transient_key, $slug);
                    break;
                case 'theme':
                    self::update_theme($transient_key, $slug);
                    break;
                default:
                    throw new \InvalidArgumentException("Unknown update_type: {$update_type}");
            }

            self::update_job_state($transient_key, 'complete', 'Update completed successfully');
        } catch (\Throwable $e) {
            self::update_job_state($transient_key, 'failed', $e->getMessage());
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    private static function update_core(string $transient_key): void
    {
        require_once ABSPATH . 'wp-admin/includes/update.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        require_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';

        self::update_job_state($transient_key, 'running', 'Downloading WordPress core update');

        // Get the available core update
        $updates = get_site_transient('update_core');
        if (empty($updates->updates)) {
            self::update_job_state($transient_key, 'complete', 'No core update available');
            return;
        }

        $update   = $updates->updates[0];
        $upgrader = new \Core_Upgrader(new \Automatic_Upgrader_Skin());
        $result   = $upgrader->upgrade($update, ['attempt_rollback' => true]);

        if (is_wp_error($result)) {
            throw new \RuntimeException($result->get_error_message());
        }
    }

    private static function update_plugin(string $transient_key, string $slug): void
    {
        require_once ABSPATH . 'wp-admin/includes/update.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        require_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';

        if (empty($slug)) {
            throw new \InvalidArgumentException('Plugin slug is required');
        }

        self::update_job_state($transient_key, 'running', "Updating plugin: {$slug}");

        $upgrader = new \Plugin_Upgrader(new \Automatic_Upgrader_Skin());
        $result   = $upgrader->upgrade($slug);

        if (is_wp_error($result)) {
            throw new \RuntimeException($result->get_error_message());
        }
    }

    private static function update_theme(string $transient_key, string $slug): void
    {
        require_once ABSPATH . 'wp-admin/includes/update.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        require_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';

        if (empty($slug)) {
            throw new \InvalidArgumentException('Theme slug is required');
        }

        self::update_job_state($transient_key, 'running', "Updating theme: {$slug}");

        $upgrader = new \Theme_Upgrader(new \Automatic_Upgrader_Skin());
        $result   = $upgrader->upgrade($slug);

        if (is_wp_error($result)) {
            throw new \RuntimeException($result->get_error_message());
        }
    }

    /**
     * @return array<string, string>|null
     */
    private static function get_core_update(): ?array
    {
        $updates = get_site_transient('update_core');
        if (empty($updates->updates)) {
            return null;
        }

        $update = $updates->updates[0] ?? null;
        if (! $update || $update->response === 'latest') {
            return null;
        }

        return [
            'current_version'   => get_bloginfo('version'),
            'available_version' => $update->version ?? '',
            'changelog_url'     => 'https://wordpress.org/documentation/article/wordpress-versions/',
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private static function get_plugin_updates(): array
    {
        $updates        = get_site_transient('update_plugins');
        $active_plugins = (array) get_option('active_plugins', []);
        $all_plugins    = get_plugins();
        $plugin_updates = [];

        if (empty($updates->response)) {
            return $plugin_updates;
        }

        foreach ($updates->response as $plugin_file => $plugin_data) {
            $plugin_info = $all_plugins[$plugin_file] ?? [];
            $plugin_updates[] = [
                'slug'              => $plugin_data->slug ?? dirname($plugin_file),
                'name'              => $plugin_info['Name'] ?? $plugin_data->slug ?? $plugin_file,
                'current_version'   => $plugin_info['Version'] ?? '',
                'available_version' => $plugin_data->new_version ?? '',
                'changelog_url'     => 'https://wordpress.org/plugins/' . ($plugin_data->slug ?? '') . '/#developers',
                'is_active'         => in_array($plugin_file, $active_plugins, true),
            ];
        }

        return $plugin_updates;
    }

    /**
     * @return array<int, array<string, string>>
     */
    private static function get_theme_updates(): array
    {
        $updates       = get_site_transient('update_themes');
        $all_themes    = wp_get_themes();
        $theme_updates = [];

        if (empty($updates->response)) {
            return $theme_updates;
        }

        foreach ($updates->response as $theme_slug => $theme_data) {
            $theme = $all_themes[$theme_slug] ?? null;
            $theme_updates[] = [
                'slug'              => $theme_slug,
                'name'              => $theme ? $theme->get('Name') : $theme_slug,
                'current_version'   => $theme ? $theme->get('Version') : '',
                'available_version' => $theme_data['new_version'] ?? '',
            ];
        }

        return $theme_updates;
    }

    /**
     * @param array<string, string> $data
     */
    private static function update_job_state(string $transient_key, string $status, string $message): void
    {
        set_transient($transient_key, ['status' => $status, 'message' => $message], 600);
    }
}
