# momome/momome-php

```php
$momome = new \MoMoMe\Client(getenv('MOMOME_KEY'));   // mm_test_… → sandbox, mm_live_… → production
$quote = $momome->quotes->create(['source' => ['asset' => 'USDT', 'network' => 'ETHEREUM'], 'destination' => ['country' => 'CM', 'amount' => '25000']]);
$payment = $momome->payments->create(['quote_id' => $quote['id'], 'reference' => 'ORDER-1', 'recipient' => ['phone' => '+237670123456']], ['idempotency_key' => 'ORDER-1']);
echo $payment['payment_instructions']['uri'];
$settled = $momome->payments->waitUntilSettled($payment['id']);

// Webhook (raw body!)
if (!\MoMoMe\Client::verifyWebhookSignature(file_get_contents('php://input'), $_SERVER['HTTP_X_MOMOME_SIGNATURE'] ?? null, getenv('MOMOME_WEBHOOK_SECRET'))) { http_response_code(400); exit; }
```

Laravel: the service provider is auto-discovered; set `services.momome.key`. `MoMoMe::payments()->create([...])`.
Errors throw `MoMoMeException` with `$errorCode`, `$details`, `$requestId`. Docs: https://momome.xyz/developers
