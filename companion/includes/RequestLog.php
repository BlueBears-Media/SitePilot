<?php
declare(strict_types=1);

namespace SitePilot;

/**
 * RequestLog — stores a capped in-plugin log for recent SitePilot activity.
 *
 * This is intentionally lightweight and admin-visible so we can debug
 * companion requests on hosts where PHP or web server logs are hard to reach.
 */
class RequestLog
{
    private const OPTION_LOG = 'sitepilot_request_log';
    private const MAX_ENTRIES = 150;
    private const MAX_STRING_LENGTH = 300;
    private const MAX_ARRAY_ITEMS = 20;

    /**
     * @param array<string, mixed> $context
     */
    public static function info(string $message, array $context = []): void
    {
        self::append('info', $message, $context);
    }

    /**
     * @param array<string, mixed> $context
     */
    public static function warning(string $message, array $context = []): void
    {
        self::append('warning', $message, $context);
    }

    /**
     * @param array<string, mixed> $context
     */
    public static function error(string $message, array $context = []): void
    {
        self::append('error', $message, $context);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function get_entries(): array
    {
        $entries = get_option(self::OPTION_LOG, []);
        return is_array($entries) ? $entries : [];
    }

    public static function clear(): void
    {
        update_option(self::OPTION_LOG, [], false);
    }

    /**
     * @param array<string, mixed> $context
     */
    private static function append(string $level, string $message, array $context): void
    {
        $entries = self::get_entries();

        array_unshift($entries, [
            'timestamp' => current_time('mysql', true),
            'level'     => $level,
            'message'   => self::truncate($message),
            'context'   => self::sanitize_context($context),
        ]);

        if (count($entries) > self::MAX_ENTRIES) {
            $entries = array_slice($entries, 0, self::MAX_ENTRIES);
        }

        update_option(self::OPTION_LOG, $entries, false);
    }

    /**
     * @param array<string, mixed> $context
     * @return array<string, mixed>
     */
    private static function sanitize_context(array $context, int $depth = 0): array
    {
        $sanitized = [];

        foreach ($context as $key => $value) {
            $sanitized[(string) $key] = self::sanitize_value((string) $key, $value, $depth);
        }

        return $sanitized;
    }

    private static function sanitize_value(string $key, mixed $value, int $depth): mixed
    {
        if (preg_match('/token|signature|secret|password|authorization|signed_url/i', $key) === 1) {
            return '[redacted]';
        }

        if (is_null($value) || is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }

        if (is_string($value)) {
            return self::truncate($value);
        }

        if (is_array($value)) {
            if ($depth >= 2) {
                return '[truncated]';
            }

            $result = [];
            $count = 0;

            foreach ($value as $child_key => $child_value) {
                if ($count >= self::MAX_ARRAY_ITEMS) {
                    $result['__truncated__'] = 'Additional items omitted';
                    break;
                }

                $result[(string) $child_key] = self::sanitize_value((string) $child_key, $child_value, $depth + 1);
                $count++;
            }

            return $result;
        }

        if ($value instanceof \WP_Error) {
            return [
                'code'    => $value->get_error_code(),
                'message' => self::truncate($value->get_error_message()),
            ];
        }

        if (is_object($value)) {
            return '[object ' . get_class($value) . ']';
        }

        return '[unsupported]';
    }

    private static function truncate(string $value): string
    {
        return strlen($value) > self::MAX_STRING_LENGTH
            ? substr($value, 0, self::MAX_STRING_LENGTH - 3) . '...'
            : $value;
    }
}
