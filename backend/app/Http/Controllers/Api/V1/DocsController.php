<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocsController extends Controller
{
    /**
     * Serve the OpenAPI 3.1 schema specification.
     */
    public function spec(Request $request): JsonResponse
    {
        $specPath = public_path('docs/openapi.json');

        if (file_exists($specPath)) {
            $spec = json_decode(file_get_contents($specPath), true);
            return response()->json($spec);
        }

        return response()->json([
            'openapi' => '3.1.0',
            'info'    => [
                'title'       => 'FLY Aviation REST API',
                'version'     => '1.0.0',
                'description' => 'Backend REST API foundation for the FLY Flight Ticketing Platform.',
            ],
            'paths'   => (object) [],
        ]);
    }
}
