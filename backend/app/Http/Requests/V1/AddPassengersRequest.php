<?php

namespace App\Http\Requests\V1;

use Illuminate\Foundation\Http\FormRequest;

class AddPassengersRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'passengers'                                => ['required', 'array', 'min:1', 'max:9'],
            'passengers.*.type'                         => ['required', 'string', 'in:adult,child,infant'],
            'passengers.*.title'                        => ['required', 'string', 'in:Mr,Mrs,Ms,Miss,Master,Dr'],
            'passengers.*.first_name'                   => ['required', 'string', 'min:2', 'max:100'],
            'passengers.*.last_name'                    => ['required', 'string', 'min:2', 'max:100'],
            'passengers.*.date_of_birth'                => ['required', 'date', 'before:today'],
            'passengers.*.gender'                       => ['nullable', 'string', 'in:male,female,other'],
            'passengers.*.nationality'                  => ['nullable', 'string', 'size:2'],
            'passengers.*.wheelchair_required'          => ['nullable', 'boolean'],
            'passengers.*.document'                     => ['nullable', 'array'],
            'passengers.*.document.document_type'       => ['nullable', 'string', 'in:passport,national_id,birth_certificate'],
            'passengers.*.document.document_number'     => ['nullable', 'string', 'min:4', 'max:40'],
            'passengers.*.document.issuing_country'     => ['nullable', 'string', 'size:2'],
            'passengers.*.document.expiry_date'         => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'passengers.required'                    => 'At least one passenger must be provided.',
            'passengers.*.first_name.required'       => 'Passenger first name is required.',
            'passengers.*.last_name.required'        => 'Passenger last name is required.',
            'passengers.*.date_of_birth.required'    => 'Passenger date of birth is required.',
            'passengers.*.date_of_birth.before'      => 'Date of birth must be a past date.',
        ];
    }
}
