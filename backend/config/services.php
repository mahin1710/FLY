<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Amadeus Self-Service / Enterprise Flight Provider
    |--------------------------------------------------------------------------
    |
    | Credentials for Amadeus for Developers sandbox / production environments.
    | Read strictly from environment secrets. Never hardcode API keys.
    |
    */
    'amadeus' => [
        'client_id'     => env('AMADEUS_CLIENT_ID'),
        'client_secret' => env('AMADEUS_CLIENT_SECRET'),
        'environment'   => env('AMADEUS_ENVIRONMENT', 'test'),
        'base_url'      => env('AMADEUS_BASE_URL', 'https://test.api.amadeus.com'),
        'timeout'       => (float) env('AMADEUS_TIMEOUT', 15.0),
    ],

];
