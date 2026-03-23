=== SitePilot Companion ===
Contributors: sitepilot
Tags: backup, updates, management, remote, automation
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.1
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects this WordPress site to a SitePilot instance for automated backups, updates, and monitoring.

== Description ==

SitePilot Companion is the bridge between your WordPress site and your self-hosted SitePilot instance.

Once configured, SitePilot can:

* Create full, database-only, or files-only backups streamed directly to your storage provider
* Check for WordPress core, plugin, and theme updates
* Apply updates automatically with pre-update backup safety snapshots
* Roll back your site to any previous backup state
* Monitor site health and uptime

**Security**

All communication between SitePilot and the companion plugin is authenticated with HMAC-SHA256 signatures and protected against replay attacks with a 5-minute timestamp window. The companion token is stored securely and can only be set — never read back — through the admin interface.

**Requirements**

* WordPress 6.0 or higher
* PHP 8.1 or higher
* PharData extension (for tar.gz extraction during restore)

**Privacy**

This plugin does not collect or transmit any data to third parties. All communication is between your WordPress site and your own self-hosted SitePilot instance.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/sitepilot-companion/`
2. Activate the plugin through the **Plugins** menu in WordPress
3. Go to **Settings → SitePilot**
4. Add your site in SitePilot, copy the one-time companion token
5. Paste the token into the **Companion token** field
6. Enable the companion and save

== Frequently Asked Questions ==

= Where do I get the companion token? =

Add your site in your SitePilot dashboard. The token is shown exactly once at site creation. Copy it immediately and paste it here.

= Can I change the token later? =

Yes — in SitePilot, delete and re-add the site to generate a new token. Then update the token in this plugin's settings.

= What happens when I deactivate the plugin? =

Settings are preserved. Reactivating the plugin will restore the previous configuration.

= What happens when I uninstall the plugin? =

All SitePilot-related options are deleted from the WordPress database.

= Does this plugin support multisite? =

Single-site installations are fully supported. Multisite support is planned for a future release.

== Changelog ==

= 1.0.0 =
* Initial release
* Full, database-only, and files-only backup streaming
* WordPress core, plugin, and theme update detection and application
* One-click rollback via companion restore endpoint
* Health check endpoint
* Admin settings page with connection status, environment info, and danger zone

== Upgrade Notice ==

= 1.0.0 =
Initial release.
