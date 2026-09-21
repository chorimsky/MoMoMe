<?php
declare(strict_types=1);
namespace MoMoMe;

/**
 * MoMo›Me API v1 client (https://momome.xyz/developers). Aligned with GET /v1/openapi.json.
 *
 *   $momome = new \MoMoMe\Client(getenv('MOMOME_KEY'));           // mm_test_… → sandbox, mm_live_… → production
 *   $quote = $momome->quotes->create(['source' => ['asset' => 'USDT', 'network' => 'ETHEREUM'], 'destination' => ['country' => 'CM', 'amount' => '25000']]);
 *   $payment = $momome->payments->create(['quote_id' => $quote['id'], 'reference' => 'ORDER-1', 'recipient' => ['phone' => '+237670123456']], ['idempotency_key' => 'ORDER-1']);
 *
 * Every method returns the `data` array of the envelope and throws MoMoMeException on `error`.
 */
final class Client
{
    public const LIVE = 'https://api.momome.xyz/v1';
    public const SANDBOX = 'https://sandbox.api.momome.xyz/v1';
    public readonly string $environment;
    public readonly string $baseUrl;
    public readonly Quotes $quotes; public readonly Payments $payments; public readonly Recipients $recipients; public readonly Webhooks $webhooks; public readonly Settlements $settlements; public readonly Account $account; public readonly Sandbox $sandbox;

    public function __construct(private readonly string $credential, array $options = [])
    {
        if (!preg_match('/^mm_(live|test)_[0-9a-f]{32}$/', $credential)) throw new MoMoMeException(0, 'credential_invalid', 'Pass an API credential (mm_live_… or mm_test_…).');
        $this->environment = str_starts_with($credential, 'mm_live_') ? 'live' : 'test';
        $this->baseUrl = rtrim($options['base_url'] ?? ($this->environment === 'live' ? self::LIVE : ($options['sandbox_url'] ?? self::SANDBOX)), '/');
        $this->timeout = (int) ($options['timeout'] ?? 30);
        $this->quotes = new Quotes($this); $this->payments = new Payments($this); $this->recipients = new Recipients($this); $this->webhooks = new Webhooks($this); $this->settlements = new Settlements($this); $this->account = new Account($this); $this->sandbox = new Sandbox($this);
    }
    private int $timeout;

    /** @return array<string,mixed> */
    public function request(string $method, string $path, ?array $body = null, array $options = [], bool $idempotent = false): array
    {
        $headers = ['Authorization: Bearer ' . $this->credential, 'Content-Type: application/json', 'Accept: application/json', 'User-Agent: momome-php/1.0.0'];
        if ($idempotent) $headers[] = 'Idempotency-Key: ' . ($options['idempotency_key'] ?? ('sdk_' . bin2hex(random_bytes(8))));
        if (!empty($options['request_id'])) $headers[] = 'X-Request-Id: ' . $options['request_id'];
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => $this->timeout, CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR)]);
        if ($body === null && in_array($method, ['POST', 'PATCH'], true)) curl_setopt($ch, CURLOPT_POSTFIELDS, '{}');
        $raw = curl_exec($ch);
        if ($raw === false) { $e = curl_error($ch); curl_close($ch); throw new MoMoMeException(0, 'network_error', "Could not reach MoMo›Me: $e"); }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
        $j = json_decode((string) $raw, true);
        if (!is_array($j)) throw new MoMoMeException($status, 'bad_response', "Non-JSON response ($status).");
        if ($status >= 400 || isset($j['error'])) throw new MoMoMeException($status, $j['error']['code'] ?? 'http_error', $j['error']['message'] ?? "HTTP $status", $j['error']['details'] ?? [], $j['meta']['request_id'] ?? null);
        return $j['data'] ?? [];
    }
    public static function query(array $params): string { $p = array_filter($params, fn ($v) => $v !== null && $v !== ''); return $p ? '?' . http_build_query($p) : ''; }

    /** Verify a webhook delivery: pass the RAW body and the X-MoMoMe-Signature header. */
    public static function verifyWebhookSignature(string $rawBody, ?string $signatureHeader, string $secret, int $toleranceMs = 300000): bool
    {
        if (!$signatureHeader || !preg_match('/t=(\d+)/', $signatureHeader, $t) || !preg_match('/v1=([0-9a-f]+)/', $signatureHeader, $v)) return false;
        if (abs((int) (microtime(true) * 1000) - (int) $t[1]) > $toleranceMs) return false;
        return hash_equals(hash_hmac('sha256', $t[1] . '.' . $rawBody, $secret), $v[1]);
    }
}

final class Quotes { public function __construct(private Client $c) {}
    public function create(array $body, array $o = []): array { return $this->c->request('POST', '/quotes', $body, $o, true); }
    public function get(string $id): array { return $this->c->request('GET', "/quotes/$id"); } }
final class Payments { public function __construct(private Client $c) {}
    public function create(array $body, array $o = []): array { return $this->c->request('POST', '/payments', $body, $o, true); }
    public function get(string $id): array { return $this->c->request('GET', "/payments/$id"); }
    /** Long-poll until the status changes from $status (≤30 s). */
    public function wait(string $id, string $status, int $seconds = 25): array { return $this->c->request('GET', "/payments/$id" . Client::query(['wait' => $seconds, 'status' => $status])); }
    public function waitUntilSettled(string $id, int $timeoutSeconds = 900): array { $t0 = time(); $p = $this->get($id); $terminal = ['COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED', 'REFUNDED', 'MANUAL_REVIEW']; while (!in_array($p['status'], $terminal, true) && time() - $t0 < $timeoutSeconds) $p = $this->wait($id, $p['status']); return $p; }
    public function list(array $params = []): array { return $this->c->request('GET', '/payments' . Client::query($params)); }
    public function cancel(string $id, array $o = []): array { return $this->c->request('POST', "/payments/$id/cancel", [], $o, true); }
    public function refund(string $id, array $body, array $o = []): array { return $this->c->request('POST', "/payments/$id/refund", $body, $o, true); }
    public function retry(string $id, array $o = []): array { return $this->c->request('POST', "/payments/$id/retry", [], $o, true); } }
final class Recipients { public function __construct(private Client $c) {}
    public function validate(array $body): array { return $this->c->request('POST', '/recipients/validate', $body); } }
final class Webhooks { public function __construct(private Client $c) {}
    public function create(array $body, array $o = []): array { return $this->c->request('POST', '/webhooks', $body, $o, true); }
    public function list(): array { return $this->c->request('GET', '/webhooks'); }
    public function get(string $id): array { return $this->c->request('GET', "/webhooks/$id"); }
    public function update(string $id, array $body): array { return $this->c->request('PATCH', "/webhooks/$id", $body); }
    public function delete(string $id): array { return $this->c->request('DELETE', "/webhooks/$id"); }
    public function test(string $id): array { return $this->c->request('POST', "/webhooks/$id/test", []); }
    public function replay(string $id, string $eventId): array { return $this->c->request('POST', "/webhooks/$id/replay", ['event_id' => $eventId]); }
    public function deliveries(string $id): array { return $this->c->request('GET', "/webhooks/$id/deliveries"); } }
final class Settlements { public function __construct(private Client $c) {}
    public function create(array $body, array $o = []): array { return $this->c->request('POST', '/settlements', $body, $o, true); }
    public function list(): array { return $this->c->request('GET', '/settlements'); }
    public function get(string $id): array { return $this->c->request('GET', "/settlements/$id"); }
    public function cancel(string $id, array $o = []): array { return $this->c->request('POST', "/settlements/$id/cancel", [], $o, true); } }
final class Account { public function __construct(private Client $c) {}
    public function get(): array { return $this->c->request('GET', '/account'); }
    public function balances(): array { return $this->c->request('GET', '/account/balances'); }
    public function usage(array $params = []): array { return $this->c->request('GET', '/usage' . Client::query($params)); }
    public function transactions(array $params = []): array { return $this->c->request('GET', '/transactions' . Client::query($params)); }
    public function transaction(string $id): array { return $this->c->request('GET', "/transactions/$id"); } }
final class Sandbox { public function __construct(private Client $c) {}
    public function scenarios(): array { return $this->c->request('GET', '/sandbox/scenarios'); }
    public function pay(string $paymentId): array { return $this->c->request('POST', "/sandbox/payments/$paymentId/pay", []); } }
