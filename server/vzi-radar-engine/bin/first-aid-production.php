#!/usr/bin/env php
<?php

declare(strict_types=1);

const VZI_FA_PROD_RUNNER_VERSION = '1.0.0';
const VZI_FA_PROD_WP_ROOT = '/home/ocnk11/domains/vozniski-izpit.com/public_html/nova';
const VZI_FA_PROD_PLUGIN_REL = 'vzi-prva-pomoc-radar/vzi-prva-pomoc-radar.php';
const VZI_FA_PROD_PLUGIN_VERSION = '0.1.1';
const VZI_FA_PROD_MAIN_BYTES = 51059;
const VZI_FA_PROD_MAIN_SHA256 = '36fcaccfd8b01dc9783ce51c9b30207204b7d77c17ab320593b9a7c303a1258f';
const VZI_FA_PROD_STATE_ROOT = '/home/ocnk11/vzi-radar-state/first-aid-radar';

function vziFaProdAtomicWriteJson(string $path, array $payload): void
{
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('OUTPUT_DIRECTORY_CREATE_FAILED');
    }
    $temporary = tempnam($directory, '.vzi-fa-prod-');
    if ($temporary === false) {
        throw new RuntimeException('OUTPUT_TEMP_CREATE_FAILED');
    }
    chmod($temporary, 0600);
    $json = json_encode(
        $payload,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    ) . PHP_EOL;
    if (file_put_contents($temporary, $json, LOCK_EX) === false || !rename($temporary, $path)) {
        @unlink($temporary);
        throw new RuntimeException('OUTPUT_WRITE_FAILED');
    }
}

function vziFaProdSelfTest(): void
{
    $path = sys_get_temp_dir() . '/vzi-fa-prod-self-test-' . getmypid() . '.json';
    vziFaProdAtomicWriteJson($path, ['schema_version' => 1, 'status' => 'PASS']);
    $decoded = json_decode((string) file_get_contents($path), true, 8, JSON_THROW_ON_ERROR);
    @unlink($path);
    if (($decoded['schema_version'] ?? null) !== 1 || ($decoded['status'] ?? null) !== 'PASS') {
        throw new RuntimeException('SELF_TEST_ATOMIC_JSON_FAILED');
    }
    fwrite(STDOUT, 'First Aid Radar production runner self-test PASS.' . PHP_EOL);
}

if (in_array('--self-test', $argv, true)) {
    vziFaProdSelfTest();
    exit(0);
}

$lockDirectory = VZI_FA_PROD_STATE_ROOT . '/locks';
if (!is_dir($lockDirectory) && !mkdir($lockDirectory, 0700, true) && !is_dir($lockDirectory)) {
    fwrite(STDERR, 'LOCK_DIRECTORY_CREATE_FAILED' . PHP_EOL);
    exit(2);
}
$lock = fopen($lockDirectory . '/production-run.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDOUT, 'Another First Aid Radar production run is active.' . PHP_EOL);
    exit(0);
}

$runId = gmdate('Ymd\\THis\\Z');
$run = [
    'schema_version' => 1,
    'runner_version' => VZI_FA_PROD_RUNNER_VERSION,
    'run_id' => $runId,
    'started_at' => gmdate('c'),
    'status' => 'HOLD',
    'callback' => 'VZI_Prva_Pomoc_Radar::instance()->sync_all_sources()',
    'acceptance_required' => true,
];
$wordpressLoaded = false;
$hardFailure = null;

try {
    $wpLoad = VZI_FA_PROD_WP_ROOT . '/wp-load.php';
    if (!is_file($wpLoad)) {
        throw new RuntimeException('WP_LOAD_NOT_FOUND');
    }
    require_once $wpLoad;
    $wordpressLoaded = true;
    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    $mainFile = WP_PLUGIN_DIR . '/' . VZI_FA_PROD_PLUGIN_REL;
    $pluginData = is_file($mainFile) ? get_file_data($mainFile, ['Version' => 'Version']) : ['Version' => ''];
    if (!is_plugin_active(VZI_FA_PROD_PLUGIN_REL)) {
        throw new RuntimeException('PLUGIN_NOT_ACTIVE');
    }
    if ((string) ($pluginData['Version'] ?? '') !== VZI_FA_PROD_PLUGIN_VERSION) {
        throw new RuntimeException('PLUGIN_VERSION_MISMATCH');
    }
    if (!is_file($mainFile) || (int) filesize($mainFile) !== VZI_FA_PROD_MAIN_BYTES) {
        throw new RuntimeException('PLUGIN_MAIN_BYTES_MISMATCH');
    }
    if (!hash_equals(VZI_FA_PROD_MAIN_SHA256, (string) hash_file('sha256', $mainFile))) {
        throw new RuntimeException('PLUGIN_MAIN_SHA256_MISMATCH');
    }
    if (!class_exists('VZI_Prva_Pomoc_Radar')) {
        throw new RuntimeException('PLUGIN_CALLBACK_CLASS_MISSING');
    }

    global $wpdb;
    $sourceTable = $wpdb->prefix . 'vzi_pp_sources';
    $termsTable = $wpdb->prefix . 'vzi_pp_terms';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $sourceTable)) !== $sourceTable
        || $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $termsTable)) !== $termsTable) {
        throw new RuntimeException('DATA_TABLE_MISSING');
    }

    $rollback = [
        'schema_version' => 1,
        'runner_version' => VZI_FA_PROD_RUNNER_VERSION,
        'run_id' => $runId,
        'captured_at' => gmdate('c'),
        'source_table' => $sourceTable,
        'terms_table' => $termsTable,
        'sources' => $wpdb->get_results("SELECT * FROM {$sourceTable} ORDER BY id ASC", ARRAY_A),
        'terms' => $wpdb->get_results("SELECT * FROM {$termsTable} ORDER BY id ASC", ARRAY_A),
    ];
    vziFaProdAtomicWriteJson(
        VZI_FA_PROD_STATE_ROOT . '/rollback/pre-run-' . $runId . '.json',
        $rollback
    );

    $syncResult = VZI_Prva_Pomoc_Radar::instance()->sync_all_sources();
    $run['sync_result'] = is_array($syncResult) ? $syncResult : ['unexpected_type' => get_debug_type($syncResult)];
    $run['status'] = is_array($syncResult) && ($syncResult['ok'] ?? false) === true ? 'SYNC_OK' : 'SYNC_HOLD';
} catch (Throwable $error) {
    $hardFailure = preg_replace('/[^A-Za-z0-9_:.-]/', '_', $error->getMessage());
    $run['status'] = 'HARD_FAILURE';
    $run['reason'] = $hardFailure;
} finally {
    $run['finished_at'] = gmdate('c');
    try {
        vziFaProdAtomicWriteJson(VZI_FA_PROD_STATE_ROOT . '/production-last-run.json', $run);
    } catch (Throwable $writeError) {
        fwrite(STDERR, 'PRODUCTION_STATE_WRITE_FAILED' . PHP_EOL);
    }
    flock($lock, LOCK_UN);
    fclose($lock);
}

if (!$wordpressLoaded) {
    fwrite(STDERR, 'First Aid Radar production runner fatal: ' . ($hardFailure ?? 'UNKNOWN') . PHP_EOL);
    exit(2);
}

// The acceptance wrapper owns last-good, health transitions and the alert outbox.
$argv = [__DIR__ . '/first-aid-radar.php'];
require __DIR__ . '/first-aid-radar.php';
