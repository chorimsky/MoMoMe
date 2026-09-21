<?php
declare(strict_types=1);
namespace MoMoMe;

/** The API's error envelope as an exception: $code is the stable string (`quote_expired`…). */
final class MoMoMeException extends \RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message, public readonly array $details = [], public readonly ?string $requestId = null)
    { parent::__construct($message, $status); }
}
