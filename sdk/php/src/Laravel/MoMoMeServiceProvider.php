<?php
declare(strict_types=1);
namespace MoMoMe\Laravel;

use Illuminate\Support\ServiceProvider;
use MoMoMe\Client;

/** config/services.php → 'momome' => ['key' => env('MOMOME_KEY'), 'webhook_secret' => env('MOMOME_WEBHOOK_SECRET')] */
final class MoMoMeServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Client::class, fn ($app) => new Client((string) config('services.momome.key'), (array) config('services.momome.options', [])));
        $this->app->alias(Client::class, 'momome');
    }
}
