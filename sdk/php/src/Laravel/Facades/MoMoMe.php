<?php
declare(strict_types=1);
namespace MoMoMe\Laravel\Facades;

use Illuminate\Support\Facades\Facade;

/**
 * MoMoMe::payments()->create([...]) — the facade exposes the client's resource objects.
 * @see \MoMoMe\Client
 */
final class MoMoMe extends Facade
{
    protected static function getFacadeAccessor(): string { return 'momome'; }
    public static function __callStatic($method, $args)
    {
        $client = static::getFacadeRoot();
        if (property_exists($client, $method)) return $client->$method;
        return parent::__callStatic($method, $args);
    }
}
