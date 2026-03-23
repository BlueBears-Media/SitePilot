<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * Auth — HMAC-SHA256 request verification for incoming SitePilot API calls.
 *
 * Every request from the SitePilot backend includes:
 *   X-SitePilot-Timestamp: unix timestamp
 *   X-SitePilot-Signature: HMAC-SHA256 of "timestamp.METHOD.path.sha256(body)"
 *
 * This class verifies both the timestamp (±5 minute window) and the signature,
 * preventing unauthorized access and replay attacks.
 */
class Auth
{
    /**
     * The maximum allowed clock drift between the SitePilot server and
     * this WordPress site (in seconds).
     */
    private const TIMESTAMP_WINDOW = 300; // 5 minutes

    /**
     * Verify an incoming REST request from the SitePilot backend.
     *
     * @param \WP_REST_Request $request The incoming request.
     * @return bool True if the request is authenticated, false otherwise.
     */
    public static function verify_request(\WP_REST_Request $request): bool
    {
        // 1. Check the companion is enabled
        if (! get_option('sitepilot_enabled', false)) {
            return false;
        }

        // 2. Read and validate the timestamp header
        $timestamp_raw = $request->get_header('X-SitePilot-Timestamp');
        if (empty($timestamp_raw)) {
            return false;
        }

        $timestamp = (int) $timestamp_raw;
        if (abs(time() - $timestamp) > self::TIMESTAMP_WINDOW) {
            return false; // Reject stale or future-dated requests
        }

        // 3. Read the signature header
        $provided_signature = $request->get_header('X-SitePilot-Signature');
        if (empty($provided_signature)) {
            return false;
        }

        // 4. Retrieve the stored companion token
        $token = get_option('sitepilot_token', '');
        if (empty($token)) {
            return false; // Not configured
        }

        // 5. Reconstruct the expected signature
        //    Format: HMAC-SHA256(timestamp.METHOD.path.sha256(body), token)
        $body_hash = hash('sha256', (string) $request->get_body());
        $message   = $timestamp_raw . '.' . $request->get_method()
                   . '.' . $request->get_route()
                   . '.' . $body_hash;

        $expected = hash_hmac('sha256', $message, $token);

        // 6. Constant-time comparison to prevent timing attacks
        if (! hash_equals($expected, $provided_signature)) {
            return false;
        }

        // Update last-seen timestamp for the connection status banner
        update_option('sitepilot_last_seen', current_time('mysql', true));

        return true;
    }
}
