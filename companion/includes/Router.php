<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * Router — registers all SitePilot REST API routes.
 *
 * All routes are under the namespace 'sitepilot/v1' and require HMAC
 * authentication via Auth::verify_request().
 */
class Router
{
    private const NAMESPACE = 'sitepilot/v1';

    /**
     * Register all REST routes. Called on the 'rest_api_init' hook.
     */
    public static function register_routes(): void
    {
        $auth_callback = [Auth::class, 'verify_request'];

        // GET /sitepilot/v1/health
        register_rest_route(self::NAMESPACE, '/health', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_health'],
            'permission_callback' => $auth_callback,
        ]);

        // GET /sitepilot/v1/updates
        register_rest_route(self::NAMESPACE, '/updates', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_updates'],
            'permission_callback' => $auth_callback,
        ]);

        // POST /sitepilot/v1/backup
        register_rest_route(self::NAMESPACE, '/backup', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_backup'],
            'permission_callback' => $auth_callback,
        ]);

        // POST /sitepilot/v1/apply-update
        register_rest_route(self::NAMESPACE, '/apply-update', [
            'methods'             => 'POST',
            'callback'            => [Updates::class, 'handle_apply'],
            'permission_callback' => $auth_callback,
        ]);

        // GET /sitepilot/v1/update-status
        register_rest_route(self::NAMESPACE, '/update-status', [
            'methods'             => 'GET',
            'callback'            => [Updates::class, 'handle_status'],
            'permission_callback' => $auth_callback,
        ]);

        // POST /sitepilot/v1/restore
        register_rest_route(self::NAMESPACE, '/restore', [
            'methods'             => 'POST',
            'callback'            => [Restore::class, 'handle'],
            'permission_callback' => $auth_callback,
        ]);

        // GET /sitepilot/v1/restore-status
        register_rest_route(self::NAMESPACE, '/restore-status', [
            'methods'             => 'GET',
            'callback'            => [Restore::class, 'handle_status'],
            'permission_callback' => $auth_callback,
        ]);
    }

    /**
     * Handle GET /health
     */
    public static function handle_health(\WP_REST_Request $request): \WP_REST_Response
    {
        return new \WP_REST_Response(HealthCheck::get_info(), 200);
    }

    /**
     * Handle GET /updates
     */
    public static function handle_updates(\WP_REST_Request $request): \WP_REST_Response
    {
        return new \WP_REST_Response(Updates::check(), 200);
    }

    /**
     * Handle POST /backup — streams response directly
     */
    public static function handle_backup(\WP_REST_Request $request): void
    {
        Backup::handle($request);
    }
}
