#!/usr/bin/env php
<?php

declare(strict_types=1);

const VZI_RADAR_ENGINE_VERSION = '0.1.0-shadow';
const VZI_RADAR_USER_AGENT = 'VZICourseRadar/0.1 (+https://vozniski-izpit.com/nova/termini-tecajev/)';

function fail(string $message, int $code = 1): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit($code);
}

function normalizeText(string $value): string
{
    $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim((string) preg_replace('/\s+/u', ' ', $value));
}

function containsDate(string $text): bool
{
    $months = 'januar(?:ja)?|februar(?:ja)?|marec|marca|april(?:a)?|maj(?:a)?|junij(?:a)?|julij(?:a)?|avgust(?:a)?|september|septembra|oktober|oktobra|november|novembra|december|decembra';
    return (bool) preg_match('/\b(?:[0-3]?\d)\s*[.\/-]\s*(?:0?\d|1[0-2])(?:\s*[.\/-]\s*(?:20)?\d{2})?\b/u', $text)
        || (bool) preg_match('/\b(?:[0-3]?\d)\.\s*(?:' . $months . ')(?:\s+20\d{2})?\b/ui', $text)
        || (bool) preg_match('/\b20\d{2}-[01]\d-[0-3]\d\b/u', $text);
}

function isUnavailable(string $text): bool
{
    return (bool) preg_match('/\b(?:odpovedan|odpovedano|prestavljeno|ni termina|ni razpisan|vsa mesta so zasedena|zapolnjen)\b/ui', $text);
}

function cssTokenToXpath(string $token): string
{
    if ($token === '') {
        throw new InvalidArgumentException('EMPTY_SELECTOR_TOKEN');
    }

    $tag = '*';
    if (preg_match('/^[a-z][a-z0-9_-]*/i', $token, $match)) {
        $tag = strtolower($match[0]);
        $token = substr($token, strlen($match[0]));
    }

    $predicates = [];
    while ($token !== '') {
        if (preg_match('/^#([a-z0-9_-]+)/i', $token, $match)) {
            $predicates[] = '@id=' . xpathLiteral($match[1]);
            $token = substr($token, strlen($match[0]));
            continue;
        }
        if (preg_match('/^\.([a-z0-9_-]+)/i', $token, $match)) {
            $class = xpathLiteral(' ' . $match[1] . ' ');
            $predicates[] = "contains(concat(' ', normalize-space(@class), ' '), {$class})";
            $token = substr($token, strlen($match[0]));
            continue;
        }
        if (preg_match('/^\[([a-z0-9_-]+)\*=(["\'])(.*?)\2\]/i', $token, $match)) {
            $predicates[] = 'contains(@' . strtolower($match[1]) . ', ' . xpathLiteral($match[3]) . ')';
            $token = substr($token, strlen($match[0]));
            continue;
        }
        throw new InvalidArgumentException('UNSUPPORTED_SELECTOR_TOKEN:' . $token);
    }

    return $tag . ($predicates === [] ? '' : '[' . implode(' and ', $predicates) . ']');
}

function xpathLiteral(string $value): string
{
    if (!str_contains($value, "'")) {
        return "'" . $value . "'";
    }
    if (!str_contains($value, '"')) {
        return '"' . $value . '"';
    }
    $parts = explode("'", $value);
    return 'concat(' . implode(', "\'", ', array_map(static fn(string $part): string => "'" . $part . "'", $parts)) . ')';
}

function cssToXpath(string $selector): string
{
    $selector = trim($selector);
    if ($selector === '' || str_contains($selector, ',') || str_contains($selector, ':')) {
        throw new InvalidArgumentException('UNSUPPORTED_SELECTOR:' . $selector);
    }

    $parts = preg_split('/\s*(>)\s*|\s+/u', $selector, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
    if (!is_array($parts) || $parts === []) {
        throw new InvalidArgumentException('INVALID_SELECTOR:' . $selector);
    }

    $xpath = '.';
    $axis = '//';
    foreach ($parts as $part) {
        if ($part === '>') {
            $axis = '/';
            continue;
        }
        $xpath .= $axis . cssTokenToXpath($part);
        $axis = '//';
    }
    return $xpath;
}

function isPublicIp(string $ip): bool
{
    return filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) !== false;
}

function validateTargetUrl(string $url, array $allowedHosts): array
{
    $parts = parse_url($url);
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
        throw new RuntimeException('TARGET_NOT_HTTPS');
    }
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) {
        throw new RuntimeException('TARGET_AUTH_OR_PORT_FORBIDDEN');
    }

    $host = strtolower(rtrim((string) $parts['host'], '.'));
    if (!in_array($host, $allowedHosts, true)) {
        throw new RuntimeException('TARGET_HOST_NOT_ALLOWLISTED:' . $host);
    }

    $ips = gethostbynamel($host) ?: [];
    $aaaa = dns_get_record($host, DNS_AAAA);
    if (is_array($aaaa)) {
        foreach ($aaaa as $record) {
            if (!empty($record['ipv6'])) {
                $ips[] = (string) $record['ipv6'];
            }
        }
    }
    $ips = array_values(array_unique($ips));
    if ($ips === [] || array_filter($ips, static fn(string $ip): bool => !isPublicIp($ip)) !== []) {
        throw new RuntimeException('TARGET_DNS_NOT_PUBLIC');
    }

    return [$host, $ips];
}

function requestOnce(string $url, array $allowedHosts, int $timeout): array
{
    validateTargetUrl($url, $allowedHosts);
    $headers = [];
    $handle = curl_init($url);
    if ($handle === false) {
        throw new RuntimeException('CURL_INIT_FAILED');
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => VZI_RADAR_USER_AGENT,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.2'],
        CURLOPT_HEADERFUNCTION => static function ($curl, string $header) use (&$headers): int {
            $length = strlen($header);
            $pieces = explode(':', $header, 2);
            if (count($pieces) === 2) {
                $headers[strtolower(trim($pieces[0]))] = trim($pieces[1]);
            }
            return $length;
        },
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);
    if (!is_string($body)) {
        throw new RuntimeException('HTTP_REQUEST_FAILED:' . $error);
    }
    return ['status' => $status, 'headers' => $headers, 'body' => $body];
}

function request(string $url, array $allowedHosts, int $timeout = 20): array
{
    for ($redirects = 0; $redirects <= 4; $redirects++) {
        $response = requestOnce($url, $allowedHosts, $timeout);
        if (!in_array($response['status'], [301, 302, 303, 307, 308], true)) {
            $response['url'] = $url;
            return $response;
        }
        $location = (string) ($response['headers']['location'] ?? '');
        if ($location === '') {
            throw new RuntimeException('REDIRECT_WITHOUT_LOCATION');
        }
        $url = resolveUrl($url, $location);
        validateTargetUrl($url, $allowedHosts);
    }
    throw new RuntimeException('TOO_MANY_REDIRECTS');
}

function resolveUrl(string $base, string $location): string
{
    if (preg_match('#^https://#i', $location)) {
        return $location;
    }
    $parts = parse_url($base);
    if (!is_array($parts) || empty($parts['host'])) {
        throw new RuntimeException('INVALID_REDIRECT_BASE');
    }
    if (str_starts_with($location, '//')) {
        return 'https:' . $location;
    }
    if (str_starts_with($location, '/')) {
        return 'https://' . $parts['host'] . $location;
    }
    $path = (string) ($parts['path'] ?? '/');
    return 'https://' . $parts['host'] . rtrim(dirname($path), '/.') . '/' . $location;
}

function robotsAllows(string $robots, string $path): bool
{
    $groups = [];
    $currentAgents = [];
    foreach (preg_split('/\R/u', $robots) ?: [] as $line) {
        $line = trim((string) preg_replace('/\s*#.*$/', '', $line));
        if ($line === '' || !str_contains($line, ':')) {
            continue;
        }
        [$name, $value] = array_map('trim', explode(':', $line, 2));
        $name = strtolower($name);
        if ($name === 'user-agent') {
            $currentAgents = [strtolower($value)];
            $groups[$currentAgents[0]] ??= [];
        } elseif (in_array($name, ['allow', 'disallow'], true)) {
            foreach ($currentAgents as $agent) {
                $groups[$agent][] = [$name, $value];
            }
        }
    }
    $rules = array_merge($groups['vzicourseradar'] ?? [], $groups['*'] ?? []);
    $winner = null;
    foreach ($rules as [$type, $rule]) {
        if ($rule === '' || !str_starts_with($path, $rule)) {
            continue;
        }
        if ($winner === null || strlen($rule) > strlen($winner[1]) || (strlen($rule) === strlen($winner[1]) && $type === 'allow')) {
            $winner = [$type, $rule];
        }
    }
    return $winner === null || $winner[0] !== 'disallow';
}

function extractCandidates(string $html, array $selectors, int $maxNodes): array
{
    $document = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    $loaded = $document->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    if (!$loaded) {
        throw new RuntimeException('HTML_PARSE_FAILED');
    }

    $xpath = new DOMXPath($document);
    $candidates = [];
    foreach ($selectors as $selector) {
        $nodes = $xpath->query(cssToXpath((string) $selector));
        if ($nodes === false) {
            throw new RuntimeException('SELECTOR_QUERY_FAILED:' . $selector);
        }
        foreach ($nodes as $node) {
            $text = normalizeText($node->textContent ?? '');
            if ($text === '' || !containsDate($text) || isUnavailable($text)) {
                continue;
            }
            $candidates[hash('sha256', $text)] = mb_substr($text, 0, 400);
            if (count($candidates) >= $maxNodes) {
                break 2;
            }
        }
    }
    return array_values($candidates);
}

function sourceHosts(array $source): array
{
    $hosts = [];
    foreach (['domain', 'url', 'homepage_url'] as $key) {
        $value = (string) ($source[$key] ?? '');
        $host = $key === 'domain' ? $value : (string) (parse_url($value, PHP_URL_HOST) ?: '');
        if ($host !== '') {
            $hosts[] = strtolower(rtrim($host, '.'));
        }
    }
    return array_values(array_unique($hosts));
}

function harvestSource(array $source, array &$robotsCache): array
{
    $started = microtime(true);
    $url = (string) ($source['url'] ?? '');
    $hosts = sourceHosts($source);
    [$host] = validateTargetUrl($url, $hosts);
    $robotsUrl = 'https://' . $host . '/robots.txt';
    if (!array_key_exists($robotsUrl, $robotsCache)) {
        try {
            $robotsResponse = request($robotsUrl, $hosts, 10);
            $robotsCache[$robotsUrl] = $robotsResponse['status'] === 200 ? $robotsResponse['body'] : '';
        } catch (Throwable) {
            $robotsCache[$robotsUrl] = '';
        }
    }
    $path = (string) (parse_url($url, PHP_URL_PATH) ?: '/');
    if (!robotsAllows($robotsCache[$robotsUrl], $path)) {
        throw new RuntimeException('ROBOTS_DISALLOWED');
    }

    $response = request($url, $hosts);
    if ($response['status'] < 200 || $response['status'] >= 300) {
        throw new RuntimeException('HTTP_STATUS_' . $response['status']);
    }
    if (strlen($response['body']) > 5_000_000) {
        throw new RuntimeException('HTML_TOO_LARGE');
    }
    $context = normalizeText(strip_tags($response['body']));
    $expectedContext = normalizeText((string) ($source['context_text'] ?? ''));
    $contextSeen = $expectedContext === '' || mb_stripos($context, $expectedContext) !== false || preg_match('/\bcpp\b|cestno[ -]?prometn/ui', $context);
    $candidates = extractCandidates(
        $response['body'],
        is_array($source['selectors'] ?? null) ? $source['selectors'] : [],
        max(1, min(100, (int) ($source['max_nodes'] ?? 20)))
    );

    return [
        'school_id' => (int) $source['school_id'],
        'school_name' => (string) $source['school_name'],
        'source_url' => $url,
        'status' => $contextSeen && $candidates !== [] ? 'success' : 'review',
        'http_status' => $response['status'],
        'context_seen' => (bool) $contextSeen,
        'candidate_count' => count($candidates),
        'candidate_samples' => array_slice($candidates, 0, 3),
        'content_sha256' => hash('sha256', $response['body']),
        'duration_ms' => (int) round((microtime(true) - $started) * 1000),
    ];
}

function atomicWriteJson(string $path, array $payload): void
{
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('OUTPUT_DIRECTORY_CREATE_FAILED');
    }
    $temporary = tempnam($directory, '.vzi-radar-');
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

function runSelfTest(): void
{
    $checks = 0;
    $assert = static function (bool $condition, string $message) use (&$checks): void {
        $checks++;
        if (!$condition) {
            throw new RuntimeException('SELF_TEST_FAILED:' . $message);
        }
    };
    $assert(containsDate('Tečaj CPP se začne 7. septembra 2026 ob 16.00.'), 'named date');
    $assert(containsDate('Termin: 21. 9. 2026'), 'numeric date');
    $assert(!containsDate('Prijavite se na CPP.'), 'no date');
    $assert(isUnavailable('VSA MESTA SO ZASEDENA'), 'unavailable wording');
    $assert(cssToXpath('.dogodekTermin') === ".//*[contains(concat(' ', normalize-space(@class), ' '), ' dogodekTermin ')]", 'class selector');
    $assert(str_contains(cssToXpath('a[href*="/termin="]'), "contains(@href, '/termin=')"), 'attribute selector');
    $assert(str_contains(cssToXpath('#nf-field-15-wrap .nf-field-element label'), "@id='nf-field-15-wrap'"), 'descendant selector');
    $assert(str_contains(cssToXpath('.blog-content.courses .col-lg-10 > p'), '/p'), 'child selector');
    $assert(robotsAllows("User-agent: *\nDisallow: /private\nAllow: /private/public", '/private/public/course'), 'robots allow precedence');
    $assert(!robotsAllows("User-agent: *\nDisallow: /private", '/private/course'), 'robots disallow');
    $html = '<div class="ideal-vrstica">Tečaj CPP 18. 9. 2026 ob 17:00</div><div class="ideal-vrstica">Vsa mesta so zasedena 20. 9. 2026</div>';
    $assert(count(extractCandidates($html, ['.ideal-vrstica'], 10)) === 1, 'candidate extraction');
    fwrite(STDOUT, "VZI Radar Engine self-test PASS: {$checks} checks." . PHP_EOL);
}

if (in_array('--self-test', $argv, true)) {
    runSelfTest();
    exit(0);
}

$root = dirname(__DIR__, 3);
$registryPath = getenv('VZI_RADAR_REGISTRY') ?: $root . '/config/cpp-browser-sources.json';
$outputPath = getenv('VZI_RADAR_SHADOW_OUTPUT') ?: dirname(__DIR__) . '/var/shadow-report.json';
$maxSources = filter_var(getenv('VZI_RADAR_MAX_SOURCES') ?: '5', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]) ?: 5;
$rotationValue = getenv('VZI_RADAR_ROTATION_SLOT');
$rotationValue = $rotationValue === false || $rotationValue === '' ? (string) intdiv(time(), 86400) : $rotationValue;
$rotationSlot = filter_var($rotationValue, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
if ($rotationSlot === false) {
    fail('VZI_RADAR_ROTATION_SLOT must be a non-negative integer.');
}

$lockPath = getenv('VZI_RADAR_LOCK_FILE') ?: sys_get_temp_dir() . '/vzi-radar-engine-shadow.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fail('Another VZI Radar Engine run is active.', 0);
}

try {
    $registry = json_decode((string) file_get_contents($registryPath), true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($registry['sources'] ?? null)) {
        throw new RuntimeException('INVALID_SOURCE_REGISTRY');
    }
    $sources = array_values(array_filter($registry['sources'], static fn($source): bool => is_array($source) && !empty($source['approved']) && !empty($source['enabled'])));
    if ($sources === []) {
        throw new RuntimeException('NO_ENABLED_SOURCES');
    }
    usort($sources, static fn(array $a, array $b): int => [(int) ($a['priority'] ?? 99), (int) $a['school_id']] <=> [(int) ($b['priority'] ?? 99), (int) $b['school_id']]);
    $start = ((int) $rotationSlot * $maxSources) % count($sources);
    $batch = [];
    for ($index = 0; $index < min($maxSources, count($sources)); $index++) {
        $batch[] = $sources[($start + $index) % count($sources)];
    }

    $startedAt = gmdate('c');
    $results = [];
    $robotsCache = [];
    foreach ($batch as $source) {
        try {
            $results[] = harvestSource($source, $robotsCache);
        } catch (Throwable $error) {
            $results[] = [
                'school_id' => (int) ($source['school_id'] ?? 0),
                'school_name' => (string) ($source['school_name'] ?? ''),
                'source_url' => (string) ($source['url'] ?? ''),
                'status' => 'error',
                'error_code' => preg_replace('/[^A-Z0-9_:.-]/', '_', strtoupper($error->getMessage())),
            ];
        }
        usleep(250_000);
    }

    $report = [
        'schema_version' => 1,
        'engine_version' => VZI_RADAR_ENGINE_VERSION,
        'mode' => 'shadow',
        'started_at' => $startedAt,
        'finished_at' => gmdate('c'),
        'rotation_slot' => (int) $rotationSlot,
        'source_count' => count($sources),
        'batch_size' => count($batch),
        'summary' => [
            'success' => count(array_filter($results, static fn(array $item): bool => $item['status'] === 'success')),
            'review' => count(array_filter($results, static fn(array $item): bool => $item['status'] === 'review')),
            'error' => count(array_filter($results, static fn(array $item): bool => $item['status'] === 'error')),
        ],
        'results' => $results,
    ];
    atomicWriteJson($outputPath, $report);
    fwrite(STDOUT, json_encode($report['summary'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL);
} catch (Throwable $error) {
    fail('VZI Radar Engine fatal: ' . $error->getMessage());
} finally {
    flock($lock, LOCK_UN);
    fclose($lock);
}
