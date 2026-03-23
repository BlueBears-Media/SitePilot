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
    private const REST_NAMESPACE = 'sitepilot/v1';

    /**
     * Register all REST routes. Called on the 'rest_api_init' hook.
     */
    public static function register_routes(): void
    {
        $auth_callback = [Auth::class, 'verify_request'];

        // GET /sitepilot/v1/health
        register_rest_route(self::REST_NAMESPACE, '/health', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_health'],
            'permission_callback' => $auth_callback,
        ]);

        // GET /sitepilot/v1/updates
        register_rest_route(self::REST_NAMESPACE, '/updates', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_updates'],
            'permission_callback' => $auth_callback,
        ]);

        // POST /sitepilot/v1/backup
        register_rest_route(self::REST_NAMESPACE, '/backup', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_backup'],
            'permission_callback' => $auth_callback,
        ]);

        // POST /sitepilot/v1/apply-update
        register_rest_route(self::REST_NAMESPACE, '/apply-update', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_apply_update'],
            'permission_callback' => $auth_callback,
        ]);

        // GET /sitepilot/v1/update-status
        register_rest_route(self::REST_NAMESPACE, '/update-status', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_update_status'],
            'permission_callback' => $auth_callback,
        ]);

        // POST /sitepilot/v1/restore
        register_rest_route(self::REST_NAMESPACE, '/restore', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_restore'],
            'permission_callback' => $auth_callback,
        ]);

        // GET /sitepilot/v1/restore-status
        register_rest_route(self::REST_NAMESPACE, '/restore-status', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_restore_status'],
            'permission_callback' => $auth_callback,
        ]);
    }

    /**
     * Handle GET /health
     */
    public static function handle_health(\WP_REST_Request $request): \WP_REST_Response
    {
        RequestLog::info('Handling SitePilot health request', self::build_request_context($request));
        return new \WP_REST_Response(HealthCheck::get_info(), 200);
    }

    /**
     * Handle GET /updates
     */
    public static function handle_updates(\WP_REST_Request $request): \WP_REST_Response
    {
        RequestLog::info('Handling SitePilot updates request', self::build_request_context($request));
        return new \WP_REST_Response(Updates::check(), 200);
    }

    /**
     * Handle POST /backup — streams response directly
     */
    public static function handle_backup(\WP_REST_Request $request): void
    {
        RequestLog::info('Handling SitePilot backup request', self::build_request_context($request, [
            'type' => (string) ($request->get_param('type') ?? 'full'),
        ]));
        Backup::handle($request);
    }

    public static function handle_apply_update(\WP_REST_Request $request): \WP_REST_Response
    {
        RequestLog::info('Handling SitePilot apply-update request', self::build_request_context($request, [
            'update_type' => (string) ($request->get_param('update_type') ?? ''),
            'slug'        => (string) ($request->get_param('slug') ?? ''),
        ]));
        return Updates::handle_apply($request);
    }

    public static function handle_update_status(\WP_REST_Request $request): \WP_REST_Response
    {
        RequestLog::info('Handling SitePilot update-status request', self::build_request_context($request, [
            'job_id' => (string) ($request->get_param('job_id') ?? ''),
        ]));
        return Updates::handle_status($request);
    }

    public static function handle_restore(\WP_REST_Request $request): \WP_REST_Response
    {
        RequestLog::info('Handling SitePilot restore request', self::build_request_context($request, [
            'scope' => (string) ($request->get_param('scope') ?? 'full'),
        ]));
        return Restore::handle($request);
    }

    public static function handle_restore_status(\WP_REST_Request $request): \WP_REST_Response
    {
        RequestLog::info('Handling SitePilot restore-status request', self::build_request_context($request, [
            'job_id' => (string) ($request->get_param('job_id') ?? ''),
        ]));
        return Restore::handle_status($request);
    }

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private static function build_request_context(\WP_REST_Request $request, array $extra = []): array
    {
        return $extra + [
            'method' => $request->get_method(),
            'route'  => $request->get_route(),
        ];
    }
}
