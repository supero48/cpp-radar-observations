#!/usr/bin/env php
<?php

declare(strict_types=1);

const VZI_FA_ENGINE_VERSION = '0.1.0-shadow';
const VZI_FA_GATE_VERSION = '1.0.0';
const VZI_FA_WP_ROOT = '/home/ocnk11/domains/vozniski-izpit.com/public_html/nova';
const VZI_FA_PLUGIN_REL = 'vzi-prva-pomoc-radar/vzi-prva-pomoc-radar.php';
const VZI_FA_PLUGIN_VERSION = '0.1.0';
const VZI_FA_MAIN_BYTES = 51054;
const VZI_FA_MAIN_SHA256 = '9b6456078022adfd09e1f704a422eb437a8ee52ece57b980c6dcd8ce43beb75b';
const VZI_FA_PUBLIC_URL = 'https://vozniski-izpit.com/nova/prva-pomoc/termini-tecajev-prve-pomoci/';
const VZI_FA_STATE_ROOT = '/home/ocnk11/vzi-radar-state/first-aid-radar';
const VZI_FA_MAX_FRESHNESS_SECONDS = 129600;

function vziFaFail(string $message, int $code = 1): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit($code);
}

function vziFaAtomicWriteJson(string $path, array $payload): void
{
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('OUTPUT_DIRECTORY_CREATE_FAILED');
    }
    $temporary = tempnam($directory, '.vzi-fa-');
    if ($temporary === false) {
        throw new RuntimeException('OUTPUT_TEMP_CREATE_FAILED');
    }
    chmod($temporary, 0600);
    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
    if (file_put_contents($temporary, $json, LOCK_EX) === false || !rename($temporary, $path)) {
        @unlink($temporary);
        throw new RuntimeException('OUTPUT_WRITE_FAILED');
    }
}

function vziFaReadJson(string $path, array $default): array
{
    if (!is_file($path)) {
        return $default;
    }
    $size = filesize($path);
    if ($size === false || $size < 1 || $size > 1_000_000) {
        throw new RuntimeException('STATE_FILE_SIZE_INVALID');
    }
    $decoded = json_decode((string) file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($decoded) || (int) ($decoded['schema_version'] ?? 0) !== 1) {
        throw new RuntimeException('STATE_FILE_SCHEMA_INVALID');
    }
    return $decoded;
}

function vziFaEvaluate(array $snapshot, int $now): array
{
    $reasons = [];
    if (($snapshot['plugin_active'] ?? null) !== true) {
        $reasons[] = 'PLUGIN_NOT_ACTIVE';
    }
    if ((string) ($snapshot['plugin_version'] ?? '') !== VZI_FA_PLUGIN_VERSION) {
        $reasons[] = 'PLUGIN_VERSION_MISMATCH';
    }
    if ((int) ($snapshot['main_file_bytes'] ?? -1) !== VZI_FA_MAIN_BYTES) {
        $reasons[] = 'PLUGIN_MAIN_BYTES_MISMATCH';
    }
    if ((string) ($snapshot['main_file_sha256'] ?? '') !== VZI_FA_MAIN_SHA256) {
        $reasons[] = 'PLUGIN_MAIN_SHA256_MISMATCH';
    }
    if (($snapshot['sources_table_exists'] ?? null) !== true || ($snapshot['terms_table_exists'] ?? null) !== true) {
        $reasons[] = 'DATA_TABLE_MISSING';
    }
    if ((int) ($snapshot['source_count'] ?? 0) < 1 || (int) ($snapshot['active_source_count'] ?? 0) < 1) {
        $reasons[] = 'NO_ACTIVE_SOURCES';
    }
    $futureTerms = (int) ($snapshot['future_active_terms'] ?? 0);
    if ($futureTerms < 1) {
        $reasons[] = 'NO_FUTURE_TERMS';
    }
    $limit = max(5, min(300, (int) ($snapshot['render_limit'] ?? 80)));
    if ((int) ($snapshot['shortcode_card_count'] ?? -1) !== min($futureTerms, $limit)) {
        $reasons[] = 'DB_SHORTCODE_PARITY_MISMATCH';
    }
    if ((int) ($snapshot['public_http_status'] ?? 0) !== 200) {
        $reasons[] = 'PUBLIC_HTTP_NOT_200';
    } elseif ((int) ($snapshot['public_card_count'] ?? -1) !== (int) ($snapshot['shortcode_card_count'] ?? -2)) {
        $reasons[] = 'PUBLIC_SHORTCODE_PARITY_MISMATCH';
    }
    $latestSeen = (int) ($snapshot['latest_term_seen_unix'] ?? 0);
    $latestSync = (int) ($snapshot['latest_source_sync_unix'] ?? 0);
    if ($latestSeen < 1 || $latestSync < 1 || ($now - min($latestSeen, $latestSync)) > VZI_FA_MAX_FRESHNESS_SECONDS) {
        $reasons[] = 'COLLECTION_NOT_FRESH';
    }
    if ((int) ($snapshot['source_error_count'] ?? 0) > 0) {
        $reasons[] = 'SOURCE_ERRORS_PRESENT';
    }

    $reasons = array_values(array_unique($reasons));
    sort($reasons, SORT_STRING);
    return [
        'schema_version' => 1,
        'project' => 'VOZNISKI-IZPIT.COM',
        'component' => 'first-aid-radar',
        'gate_version' => VZI_FA_GATE_VERSION,
        'engine_version' => VZI_FA_ENGINE_VERSION,
        'evaluated_at' => gmdate('c', $now),
        'mode' => 'shadow',
        'status' => $reasons === [] ? 'PASS' : 'HOLD',
        'reasons' => $reasons,
        'source_count' => max(0, (int) ($snapshot['source_count'] ?? 0)),
        'active_source_count' => max(0, (int) ($snapshot['active_source_count'] ?? 0)),
        'future_active_terms' => max(0, $futureTerms),
        'area_count' => max(0, (int) ($snapshot['area_count'] ?? 0)),
        'shortcode_card_count' => max(0, (int) ($snapshot['shortcode_card_count'] ?? 0)),
        'public_card_count' => max(0, (int) ($snapshot['public_card_count'] ?? 0)),
        'latest_term_seen_unix' => max(0, $latestSeen),
        'latest_source_sync_unix' => max(0, $latestSync),
    ];
}

function vziFaHealthTransition(array $previous, array $gate, int $now): array
{
    $status = (string) ($gate['status'] ?? 'HOLD');
    $previousStatus = (string) ($previous['status'] ?? '');
    $streak = $status === 'PASS' ? 0 : ($previousStatus === 'HOLD' ? (int) ($previous['problem_streak'] ?? 0) + 1 : 1);
    $activeProblem = (bool) ($previous['active_problem'] ?? false);
    $sequence = max(0, (int) ($previous['transition_seq'] ?? 0));
    $event = null;

    if ($status === 'HOLD' && $streak >= 2 && !$activeProblem) {
        $sequence++;
        $activeProblem = true;
        $event = [
            'event_id' => 'vzi-fa-' . $sequence . '-' . substr(hash('sha256', implode('|', $gate['reasons'] ?? [])), 0, 12),
            'generated_at' => $now,
            'kind' => 'radar_degraded',
            'severity' => 'error',
            'component' => 'first-aid-radar',
            'problem_streak' => $streak,
            'reason_codes' => array_slice(array_values($gate['reasons'] ?? []), 0, 12),
        ];
    } elseif ($status === 'PASS' && $activeProblem) {
        $sequence++;
        $activeProblem = false;
        $event = [
            'event_id' => 'vzi-fa-' . $sequence . '-' . substr(hash('sha256', 'recovered|' . $sequence), 0, 12),
            'generated_at' => $now,
            'kind' => 'radar_recovered',
            'severity' => 'info',
            'component' => 'first-aid-radar',
            'problem_streak' => 0,
            'reason_codes' => [],
        ];
    }

    return [[
        'schema_version' => 1,
        'engine_version' => VZI_FA_ENGINE_VERSION,
        'updated_at' => gmdate('c', $now),
        'status' => $status,
        'problem_streak' => $streak,
        'active_problem' => $activeProblem,
        'transition_seq' => $sequence,
        'last_pass_at' => $status === 'PASS' ? gmdate('c', $now) : (string) ($previous['last_pass_at'] ?? ''),
    ], $event];
}

function vziFaMergeOutbox(array $previous, ?array $event): array
{
    $events = is_array($previous['events'] ?? null) ? $previous['events'] : [];
    if ($event !== null) {
        $events[(string) $event['event_id']] = $event;
    }
    if (array_is_list($events)) {
        $indexed = [];
        foreach ($events as $row) {
            if (is_array($row) && is_string($row['event_id'] ?? null)) {
                $indexed[$row['event_id']] = $row;
            }
        }
        $events = $indexed;
    }
    $events = array_slice($events, -100, null, true);
    return [
        'schema_version' => 1,
        'project' => 'VOZNISKI-IZPIT.COM',
        'scope' => 'first_aid_radar_health_only',
        'updated_at' => gmdate('c'),
        'events' => $events,
    ];
}

function vziFaRunSelfTest(): void
{
    $base = [
        'plugin_active' => true,
        'plugin_version' => VZI_FA_PLUGIN_VERSION,
        'main_file_bytes' => VZI_FA_MAIN_BYTES,
        'main_file_sha256' => VZI_FA_MAIN_SHA256,
        'sources_table_exists' => true,
        'terms_table_exists' => true,
        'source_count' => 12,
        'active_source_count' => 12,
        'future_active_terms' => 42,
        'render_limit' => 80,
        'shortcode_card_count' => 42,
        'public_http_status' => 200,
        'public_card_count' => 42,
        'latest_term_seen_unix' => 1_787_972_800,
        'latest_source_sync_unix' => 1_787_972_800,
        'source_error_count' => 0,
        'area_count' => 7,
    ];
    $now = 1_787_976_400;
    $pass = vziFaEvaluate($base, $now);
    if ($pass['status'] !== 'PASS') {
        throw new RuntimeException('SELF_TEST_PASS_GATE_FAILED');
    }
    $bad = $base;
    $bad['public_card_count'] = 41;
    $hold = vziFaEvaluate($bad, $now);
    if ($hold['status'] !== 'HOLD' || !in_array('PUBLIC_SHORTCODE_PARITY_MISMATCH', $hold['reasons'], true)) {
        throw new RuntimeException('SELF_TEST_PARITY_GATE_FAILED');
    }
    [$state1, $event1] = vziFaHealthTransition(['schema_version' => 1], $hold, $now);
    [$state2, $event2] = vziFaHealthTransition($state1, $hold, $now + 60);
    [$state3, $event3] = vziFaHealthTransition($state2, $pass, $now + 120);
    if ($event1 !== null || ($event2['kind'] ?? '') !== 'radar_degraded' || ($event3['kind'] ?? '') !== 'radar_recovered' || $state3['active_problem']) {
        throw new RuntimeException('SELF_TEST_TRANSITIONS_FAILED');
    }
    fwrite(STDOUT, 'First Aid Radar server wrapper self-test PASS.' . PHP_EOL);
}

if (in_array('--self-test', $argv, true)) {
    vziFaRunSelfTest();
    exit(0);
}

if (in_array('--trigger-sync', $argv, true)) {
    vziFaFail('SYNC_NOT_AUTHORIZED_IN_SHADOW_BUILD');
}

$lockDirectory = VZI_FA_STATE_ROOT . '/locks';
if (!is_dir($lockDirectory) && !mkdir($lockDirectory, 0700, true) && !is_dir($lockDirectory)) {
    vziFaFail('LOCK_DIRECTORY_CREATE_FAILED');
}
$lock = fopen($lockDirectory . '/worker.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    vziFaFail('Another First Aid Radar wrapper run is active.', 0);
}

try {
    $wpLoad = VZI_FA_WP_ROOT . '/wp-load.php';
    if (!is_file($wpLoad)) {
        throw new RuntimeException('WP_LOAD_NOT_FOUND');
    }
    require_once $wpLoad;
    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    global $wpdb;
    $mainFile = WP_PLUGIN_DIR . '/' . VZI_FA_PLUGIN_REL;
    $sourceTable = $wpdb->prefix . 'vzi_pp_sources';
    $termsTable = $wpdb->prefix . 'vzi_pp_terms';
    $sourceTableExists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $sourceTable)) === $sourceTable;
    $termsTableExists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $termsTable)) === $termsTable;
    $pluginData = is_file($mainFile) ? get_file_data($mainFile, ['Version' => 'Version']) : ['Version' => ''];
    $settings = get_option('vzi_pp_radar_settings', []);
    $limit = max(5, min(300, (int) ($settings['terms_per_page'] ?? 80)));

    $snapshot = [
        'schema_version' => 1,
        'captured_at' => gmdate('c'),
        'plugin_active' => is_plugin_active(VZI_FA_PLUGIN_REL),
        'plugin_version' => (string) ($pluginData['Version'] ?? ''),
        'main_file_bytes' => is_file($mainFile) ? (int) filesize($mainFile) : -1,
        'main_file_sha256' => is_file($mainFile) ? hash_file('sha256', $mainFile) : '',
        'sources_table_exists' => $sourceTableExists,
        'terms_table_exists' => $termsTableExists,
        'source_count' => 0,
        'active_source_count' => 0,
        'source_error_count' => 0,
        'area_count' => 0,
        'future_active_terms' => 0,
        'latest_term_seen_unix' => 0,
        'latest_source_sync_unix' => 0,
        'render_limit' => $limit,
        'shortcode_card_count' => -1,
        'public_http_status' => 0,
        'public_card_count' => -1,
    ];

    if ($sourceTableExists && $termsTableExists) {
        $snapshot['source_count'] = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$sourceTable}");
        $snapshot['active_source_count'] = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$sourceTable} WHERE is_active = 1");
        $snapshot['source_error_count'] = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$sourceTable} WHERE is_active = 1 AND last_status = 'error'");
        $snapshot['area_count'] = (int) $wpdb->get_var("SELECT COUNT(DISTINCT ic_area) FROM {$sourceTable} WHERE ic_area <> ''");
        $snapshot['future_active_terms'] = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$termsTable} WHERE is_active = 1 AND start_at >= NOW()");
        $snapshot['latest_term_seen_unix'] = (int) $wpdb->get_var("SELECT COALESCE(UNIX_TIMESTAMP(MAX(last_seen)), 0) FROM {$termsTable} WHERE is_active = 1");
        $snapshot['latest_source_sync_unix'] = (int) $wpdb->get_var("SELECT COALESCE(UNIX_TIMESTAMP(MAX(last_sync)), 0) FROM {$sourceTable} WHERE is_active = 1");
    }

    $identitySafe = $snapshot['plugin_active']
        && $snapshot['plugin_version'] === VZI_FA_PLUGIN_VERSION
        && $snapshot['main_file_bytes'] === VZI_FA_MAIN_BYTES
        && hash_equals(VZI_FA_MAIN_SHA256, $snapshot['main_file_sha256'])
        && $sourceTableExists && $termsTableExists
        && class_exists('VZI_Prva_Pomoc_Radar');

    $snapshot['sync_executed'] = false;

    if ($identitySafe) {
        $shortcode = VZI_Prva_Pomoc_Radar::instance()->shortcode_terms(['limit' => $limit]);
        $snapshot['shortcode_card_count'] = is_string($shortcode) ? substr_count($shortcode, 'class="vzi-pp-card"') : -1;
    }
    $public = wp_remote_get(VZI_FA_PUBLIC_URL, [
        'timeout' => 20,
        'redirection' => 3,
        'limit_response_size' => 5_000_000,
        'headers' => ['User-Agent' => 'VZI-First-Aid-Radar-Acceptance/' . VZI_FA_ENGINE_VERSION],
    ]);
    if (!is_wp_error($public)) {
        $snapshot['public_http_status'] = (int) wp_remote_retrieve_response_code($public);
        $body = (string) wp_remote_retrieve_body($public);
        $snapshot['public_card_count'] = substr_count($body, 'class="vzi-pp-card"');
    }

    $now = time();
    $gate = vziFaEvaluate($snapshot, $now);
    $report = [
        'schema_version' => 1,
        'engine_version' => VZI_FA_ENGINE_VERSION,
        'mode' => 'shadow',
        'captured_at' => gmdate('c', $now),
        'sync_executed' => false,
        'snapshot' => $snapshot,
        'acceptance' => $gate,
    ];
    vziFaAtomicWriteJson(VZI_FA_STATE_ROOT . '/shadow-report.json', $report);
    vziFaAtomicWriteJson(VZI_FA_STATE_ROOT . '/shadow-acceptance.json', $gate);
    if ($gate['status'] === 'PASS') {
        vziFaAtomicWriteJson(VZI_FA_STATE_ROOT . '/last-good.json', $report);
    }

    $previousState = vziFaReadJson(VZI_FA_STATE_ROOT . '/shadow-state.json', ['schema_version' => 1]);
    [$nextState, $event] = vziFaHealthTransition($previousState, $gate, $now);
    vziFaAtomicWriteJson(VZI_FA_STATE_ROOT . '/shadow-state.json', $nextState);
    if ($event !== null) {
        $outboxPath = VZI_FA_STATE_ROOT . '/shadow-alert-outbox.json';
        $previousOutbox = vziFaReadJson($outboxPath, ['schema_version' => 1, 'events' => []]);
        vziFaAtomicWriteJson($outboxPath, vziFaMergeOutbox($previousOutbox, $event));
    }

    fwrite(STDOUT, json_encode([
        'status' => $gate['status'],
        'reasons' => $gate['reasons'],
        'future_active_terms' => $gate['future_active_terms'],
        'public_card_count' => $gate['public_card_count'],
        'sync_executed' => false,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL);
    exit($gate['status'] === 'PASS' ? 0 : 2);
} catch (Throwable $error) {
    vziFaFail('First Aid Radar wrapper fatal: ' . preg_replace('/[^A-Za-z0-9_:.-]/', '_', $error->getMessage()));
} finally {
    flock($lock, LOCK_UN);
    fclose($lock);
}
