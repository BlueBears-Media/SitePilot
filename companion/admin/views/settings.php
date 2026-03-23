<?php
declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

$token      = get_option('sitepilot_token', '');
$enabled    = (bool) get_option('sitepilot_enabled', false);
$last_seen  = get_option('sitepilot_last_seen', '');
$health     = SitePilot\HealthCheck::get_info();
$saved      = isset($_GET['saved']) && $_GET['saved'] === '1';

// Connection status calculation
$status_class   = 'notice-error';
$status_message = 'Companion is disabled or not configured.';

if (! empty($token) && $enabled) {
    if (! empty($last_seen)) {
        $last_seen_ts = strtotime($last_seen);
        $diff_minutes = (time() - $last_seen_ts) / 60;

        if ($diff_minutes <= 10) {
            $status_class   = 'notice-success';
            $status_message = 'Companion is active and communicating with SitePilot.';
        } else {
            $status_class   = 'notice-warning';
            $status_message = 'Companion is enabled but has not been contacted in more than 10 minutes.';
        }
    } else {
        $status_class   = 'notice-warning';
        $status_message = 'Companion is enabled. Awaiting first contact from SitePilot.';
    }
}

// Token display state (show input or "Token saved" message)
$show_token_input = empty($token) || isset($_GET['replace_token']);
?>

<div class="wrap">
    <h1 style="display:flex;align-items:center;gap:10px;">
        <span style="background:#0073aa;color:#fff;padding:4px 10px;border-radius:4px;font-size:13px;font-weight:600;letter-spacing:0.5px;">SP</span>
        SitePilot Companion
    </h1>

    <?php if ($saved) : ?>
        <div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
    <?php endif; ?>

    <!-- ── Connection status banner ──────────────────────────────────────── -->
    <div class="notice <?php echo esc_attr($status_class); ?>" style="margin-top:16px;">
        <p>
            <strong>Status:</strong> <?php echo esc_html($status_message); ?>
            <?php if (! empty($last_seen)) : ?>
                &mdash; Last contact: <strong><?php echo esc_html($last_seen); ?></strong>
            <?php endif; ?>
        </p>
        <p style="margin:4px 0 8px;">
            <strong>Site URL:</strong> <?php echo esc_html(get_site_url()); ?>
            &nbsp;|&nbsp;
            <strong>Plugin version:</strong> <?php echo esc_html(SITEPILOT_VERSION); ?>
        </p>
    </div>

    <!-- ── Token and enable/disable ──────────────────────────────────────── -->
    <div class="postbox" style="margin-top:20px;max-width:700px;">
        <div class="postbox-header">
            <h2 class="hndle">Connection Settings</h2>
        </div>
        <div class="inside">
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <?php wp_nonce_field('sitepilot_save_settings'); ?>
                <input type="hidden" name="action" value="sitepilot_save_settings">

                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label>Companion token</label></th>
                        <td>
                            <?php if ($show_token_input) : ?>
                                <input
                                    type="password"
                                    name="sitepilot_token"
                                    class="regular-text"
                                    autocomplete="new-password"
                                    placeholder="Paste the token from your SitePilot instance"
                                />
                                <p class="description">
                                    Generate this token by adding your site in SitePilot.
                                    It will only be shown once.
                                </p>
                            <?php else : ?>
                                <p>
                                    <span class="dashicons dashicons-lock" style="color:#46b450;vertical-align:middle;"></span>
                                    <strong>Token saved</strong> (hidden for security)
                                </p>
                                <a
                                    href="<?php echo esc_url(admin_url('options-general.php?page=sitepilot-companion&replace_token=1')); ?>"
                                    class="button button-secondary"
                                    style="margin-top:6px;"
                                >
                                    Replace token
                                </a>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="sitepilot_enabled">Enable companion</label></th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="sitepilot_enabled"
                                    id="sitepilot_enabled"
                                    value="1"
                                    <?php checked($enabled, true); ?>
                                />
                                Allow SitePilot to communicate with this site
                            </label>
                            <p class="description">
                                When disabled, all companion REST endpoints return 403 regardless of the token.
                            </p>
                        </td>
                    </tr>
                </table>

                <?php submit_button('Save settings'); ?>
            </form>
        </div>
    </div>

    <!-- ── Environment info ───────────────────────────────────────────────── -->
    <div class="postbox" style="margin-top:20px;max-width:700px;">
        <div class="postbox-header">
            <h2 class="hndle">Environment Info</h2>
        </div>
        <div class="inside">
            <?php if (! $health['phardata_available']) : ?>
                <div class="notice notice-error inline" style="margin:0 0 12px;">
                    <p>
                        <strong>Warning:</strong> PharData (tar extension) is not available.
                        Backups will fail. Please contact your hosting provider.
                    </p>
                </div>
            <?php endif; ?>

            <table class="widefat striped" style="max-width:500px;">
                <tbody>
                    <tr>
                        <td><strong>PHP version</strong></td>
                        <td><?php echo esc_html($health['php_version']); ?></td>
                        <td>
                            <?php if (version_compare($health['php_version'], '8.1', '>=')) : ?>
                                <span class="dashicons dashicons-yes" style="color:#46b450;"></span>
                            <?php else : ?>
                                <span class="dashicons dashicons-warning" style="color:#ffb900;"></span> Requires 8.1+
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <td><strong>WordPress version</strong></td>
                        <td><?php echo esc_html($health['wp_version']); ?></td>
                        <td><span class="dashicons dashicons-yes" style="color:#46b450;"></span></td>
                    </tr>
                    <tr>
                        <td><strong>Active theme</strong></td>
                        <td><?php echo esc_html($health['active_theme']['name'] . ' ' . $health['active_theme']['version']); ?></td>
                        <td></td>
                    </tr>
                    <tr>
                        <td><strong>Free disk space</strong></td>
                        <td>
                            <?php
                            $bytes = $health['disk_free_bytes'];
                            if ($bytes !== null) {
                                echo esc_html(size_format((int) $bytes));
                            } else {
                                echo 'Unknown';
                            }
                            ?>
                        </td>
                        <td>
                            <?php if ($bytes !== null && $bytes < 1_073_741_824) : // < 1 GB ?>
                                <span class="dashicons dashicons-warning" style="color:#ffb900;"></span> Low
                            <?php else : ?>
                                <span class="dashicons dashicons-yes" style="color:#46b450;"></span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <td><strong>Writable temp dir</strong></td>
                        <td><?php echo $health['temp_dir_writable'] ? 'Yes' : 'No'; ?></td>
                        <td>
                            <?php if ($health['temp_dir_writable']) : ?>
                                <span class="dashicons dashicons-yes" style="color:#46b450;"></span>
                            <?php else : ?>
                                <span class="dashicons dashicons-no" style="color:#d63638;"></span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <td><strong>PharData (tar) available</strong></td>
                        <td><?php echo $health['phardata_available'] ? 'Yes' : 'No'; ?></td>
                        <td>
                            <?php if ($health['phardata_available']) : ?>
                                <span class="dashicons dashicons-yes" style="color:#46b450;"></span>
                            <?php else : ?>
                                <span class="dashicons dashicons-no" style="color:#d63638;"></span> Required for backups
                            <?php endif; ?>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- ── Danger zone ───────────────────────────────────────────────────── -->
    <div class="postbox" style="margin-top:20px;max-width:700px;border-color:#d63638;">
        <div class="postbox-header">
            <h2 class="hndle" style="color:#d63638;">Danger Zone</h2>
        </div>
        <div class="inside">
            <p class="description" style="margin-bottom:12px;">
                Clicking the button below will delete all SitePilot configuration from this site
                and deactivate the plugin. The plugin files will not be deleted.
            </p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                  onsubmit="return confirm('This will remove all SitePilot data and deactivate the plugin. Are you sure?');">
                <?php wp_nonce_field('sitepilot_remove'); ?>
                <input type="hidden" name="action" value="sitepilot_remove">
                <button type="submit" class="button" style="background:#d63638;border-color:#b32d2e;color:#fff;">
                    Remove SitePilot
                </button>
            </form>
        </div>
    </div>
</div>
