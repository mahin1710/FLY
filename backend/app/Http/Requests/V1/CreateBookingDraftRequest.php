<?php

namespace App\Http\Requests\V1;

use Illuminate\Foundation\Http\FormRequest;

class CreateBookingDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'offer_uuid'           => ['required', 'uuid'],
            'contact_email'        => ['required', 'email', 'max:150'],
            'contact_phone'        => ['required', 'string', 'min:6', 'max:25'],
            'contact_country_code' => ['nullable', 'string', 'max:10'],
            'remarks'              => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'offer_uuid.required'    => 'A valid internal flight offer UUID is required to create a booking draft.',
            'contact_email.required' => 'Contact email address is required.',
            'contact_phone.required' => 'Contact phone number is required.',
        ];
    }
}
