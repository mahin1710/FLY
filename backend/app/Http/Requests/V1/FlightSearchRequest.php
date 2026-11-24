<?php

namespace App\Http\Requests\V1;

use Illuminate\Foundation\Http\FormRequest;

class FlightSearchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'origin'         => ['required', 'string', 'size:3', 'alpha'],
            'destination'    => ['required', 'string', 'size:3', 'alpha', 'different:origin'],
            'departure_date' => ['required', 'date', 'after_or_equal:today'],
            'return_date'    => ['nullable', 'date', 'after_or_equal:departure_date'],
            'trip_type'      => ['required', 'string', 'in:one_way,round_trip,multi_city'],
            'cabin_class'    => ['required', 'string', 'in:economy,premium_economy,business,first'],
            'adults'         => ['required', 'integer', 'min:1', 'max:9'],
            'children'       => ['nullable', 'integer', 'min:0', 'max:8'],
            'infants'        => ['nullable', 'integer', 'min:0', 'max:4'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $adults = (int) $this->input('adults', 1);
            $infants = (int) $this->input('infants', 0);
            if ($infants > $adults) {
                $validator->errors()->add('infants', 'The number of infants cannot exceed the number of accompanying adult passengers.');
            }

            if ($this->input('trip_type') === 'round_trip' && !$this->filled('return_date')) {
                $validator->errors()->add('return_date', 'Return date is required for round trip searches.');
            }
        });
    }

    protected function prepareForValidation(): void
    {
        $merges = [];
        if ($this->has('origin') && is_string($this->origin)) {
            $merges['origin'] = strtoupper($this->origin);
        }
        if ($this->has('destination') && is_string($this->destination)) {
            $merges['destination'] = strtoupper($this->destination);
        }
        if ($this->has('cabin_class') && is_string($this->cabin_class)) {
            $merges['cabin_class'] = strtolower($this->cabin_class);
        }
        if ($this->has('trip_type') && is_string($this->trip_type)) {
            $merges['trip_type'] = strtolower($this->trip_type);
        }
        if (!empty($merges)) {
            $this->merge($merges);
        }
    }
}
