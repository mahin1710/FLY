-- ============================================================================
-- FLY FLIGHT BOOKING & TICKET MANAGEMENT SYSTEM — POSTGRESQL 16+ SCHEMA
-- Target: Production PostgreSQL Database (DATABASE_URL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS airlines (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(180) NOT NULL,
    iata            VARCHAR(8) NOT NULL,
    icao            VARCHAR(8),
    logo_url        TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_airlines_iata ON airlines (UPPER(iata));

CREATE TABLE IF NOT EXISTS airports (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(220) NOT NULL,
    type            VARCHAR(60),
    iata            VARCHAR(8) UNIQUE,
    icao            VARCHAR(8),
    city            VARCHAR(120),
    country         VARCHAR(120),
    iso_country     VARCHAR(8)
);
CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports (UPPER(iata));
CREATE INDEX IF NOT EXISTS idx_airports_city ON airports (LOWER(city));

CREATE TABLE IF NOT EXISTS passengers (
    id              BIGSERIAL PRIMARY KEY,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    birth_date      DATE,
    gender          VARCHAR(20),
    country         VARCHAR(100) DEFAULT 'Bangladesh',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
    id              BIGSERIAL PRIMARY KEY,
    id_passenger    BIGINT REFERENCES passengers(id) ON DELETE SET NULL,
    id_airline      BIGINT REFERENCES airlines(id) ON DELETE SET NULL,
    username        VARCHAR(100) NOT NULL,
    password_hash   TEXT NOT NULL,
    email_address   VARCHAR(255),
    role            VARCHAR(24) NOT NULL DEFAULT 'PASSENGER'
                    CHECK (role IN ('PASSENGER', 'AIRLINE_ADMIN', 'SYSTEM_ADMIN')),
    display_name    VARCHAR(180),
    location        VARCHAR(180) DEFAULT 'Dhaka, Bangladesh',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_airline_admin_binding CHECK (role <> 'AIRLINE_ADMIN' OR id_airline IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_username_ci ON accounts (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_accounts_airline ON accounts (id_airline) WHERE id_airline IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
    token           VARCHAR(128) PRIMARY KEY,
    account_id      BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    username        VARCHAR(100) NOT NULL,
    role            VARCHAR(24) NOT NULL,
    airline_id      BIGINT REFERENCES airlines(id) ON DELETE CASCADE,
    ip_address      VARCHAR(64),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON auth_sessions (account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS flights (
    id              BIGSERIAL PRIMARY KEY,
    id_airline      BIGINT NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
    flight_number   VARCHAR(20) NOT NULL,
    dep_airport     BIGINT NOT NULL REFERENCES airports(id),
    arr_airport     BIGINT NOT NULL REFERENCES airports(id),
    dep_datetime    TIMESTAMPTZ NOT NULL,
    arr_datetime    TIMESTAMPTZ NOT NULL,
    aircraft_model  VARCHAR(100) DEFAULT 'Boeing 737-800',
    stops           SMALLINT NOT NULL DEFAULT 0 CHECK (stops >= 0),
    status          VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('SCHEDULED', 'ON_TIME', 'DELAYED', 'CANCELLED', 'COMPLETED')),
    first_price     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (first_price >= 0),
    business_price  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (business_price >= 0),
    economy_price   NUMERIC(12,2) NOT NULL CHECK (economy_price > 0),
    luggage_price   NUMERIC(12,2) NOT NULL DEFAULT 350.00 CHECK (luggage_price >= 0),
    weight_price    NUMERIC(12,2) NOT NULL DEFAULT 120.00 CHECK (weight_price >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_flight_distinct_airports CHECK (dep_airport <> arr_airport),
    CONSTRAINT chk_flight_valid_times CHECK (arr_datetime > dep_datetime)
);
CREATE INDEX IF NOT EXISTS idx_flights_route_dep ON flights (dep_airport, arr_airport, dep_datetime);
CREATE INDEX IF NOT EXISTS idx_flights_airline ON flights (id_airline, dep_datetime DESC);

CREATE TABLE IF NOT EXISTS seats (
    id              BIGSERIAL PRIMARY KEY,
    seat_column     VARCHAR(4) NOT NULL,
    seat_row        SMALLINT NOT NULL CHECK (seat_row > 0),
    cabin_type      VARCHAR(24) NOT NULL CHECK (cabin_type IN ('first', 'business', 'economy')),
    seat_category   VARCHAR(24) NOT NULL DEFAULT 'Standard',
    CONSTRAINT uq_seat_coords UNIQUE (seat_row, seat_column)
);

CREATE TABLE IF NOT EXISTS baggage_policies (
    id                  BIGSERIAL PRIMARY KEY,
    id_airline          BIGINT REFERENCES airlines(id) ON DELETE CASCADE,
    route_scope         VARCHAR(20) NOT NULL CHECK (route_scope IN ('DOMESTIC', 'INTERNATIONAL')),
    included_checked_kg INTEGER NOT NULL DEFAULT 23,
    included_pieces     INTEGER NOT NULL DEFAULT 1,
    cabin_kg            INTEGER NOT NULL DEFAULT 7,
    extra_per_kg_fee    NUMERIC(10,2) NOT NULL DEFAULT 120.00,
    extra_piece_fee     NUMERIC(10,2) NOT NULL DEFAULT 350.00,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id_airline, route_scope)
);

CREATE TABLE IF NOT EXISTS promo_codes (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(32) UNIQUE NOT NULL,
    discount_type   VARCHAR(16) NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
    discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    min_fare        NUMERIC(12,2) NOT NULL DEFAULT 0,
    max_discount    NUMERIC(12,2),
    usage_limit     INTEGER NOT NULL DEFAULT 1000,
    used_count      INTEGER NOT NULL DEFAULT 0,
    id_airline      BIGINT REFERENCES airlines(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bookings (
    id                  BIGSERIAL PRIMARY KEY,
    booking_reference   VARCHAR(48) UNIQUE NOT NULL,
    pnr_code            VARCHAR(10) UNIQUE,
    id_account          BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    id_flight           BIGINT NOT NULL REFERENCES flights(id) ON DELETE RESTRICT,
    return_flight_id    BIGINT REFERENCES flights(id) ON DELETE RESTRICT,
    trip_type           VARCHAR(24) NOT NULL DEFAULT 'one_way',
    cabin_class         VARCHAR(24) NOT NULL DEFAULT 'Economy',
    status              VARCHAR(24) NOT NULL
                        CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED')),
    total_amount        NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    promo_code          VARCHAR(32),
    nbr_luggages        INTEGER NOT NULL DEFAULT 0,
    weight              NUMERIC(8,2) NOT NULL DEFAULT 0,
    passenger_data      JSONB,
    extras_data         JSONB,
    fare_breakdown      JSONB,
    lock_extensions     SMALLINT NOT NULL DEFAULT 0,
    idempotency_key     VARCHAR(128) UNIQUE,
    payment_ref         VARCHAR(80),
    payment_method      VARCHAR(40),
    paid_at             TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    refund_amount       NUMERIC(12,2) DEFAULT 0,
    refund_status       VARCHAR(24),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_account ON bookings (id_account, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_flight ON bookings (id_flight, status);
CREATE INDEX IF NOT EXISTS idx_bookings_status_expires ON bookings (status, expires_at);

CREATE TABLE IF NOT EXISTS reservations (
    id                  BIGSERIAL PRIMARY KEY,
    booking_reference   VARCHAR(48) NOT NULL REFERENCES bookings(booking_reference) ON DELETE CASCADE,
    id_flight           BIGINT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    id_account          BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    id_seat             BIGINT NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
    status              VARCHAR(24) NOT NULL
                        CHECK (status IN ('PENDING_PAYMENT', 'HELD', 'LOCKED', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
    nbr_luggages        INTEGER NOT NULL DEFAULT 0,
    weight              NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_price         NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_ref         VARCHAR(80),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_seat_reservation
    ON reservations (id_flight, id_seat)
    WHERE status IN ('PENDING_PAYMENT', 'HELD', 'LOCKED', 'CONFIRMED');
CREATE INDEX IF NOT EXISTS idx_res_booking_ref ON reservations (booking_reference);
CREATE INDEX IF NOT EXISTS idx_res_status_expires ON reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS payments (
    id                  BIGSERIAL PRIMARY KEY,
    booking_reference   VARCHAR(48) NOT NULL REFERENCES bookings(booking_reference) ON DELETE CASCADE,
    id_account          BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    idempotency_key     VARCHAR(128) UNIQUE NOT NULL,
    amount              NUMERIC(12,2) NOT NULL,
    currency            VARCHAR(8) NOT NULL DEFAULT 'BDT',
    payment_method      VARCHAR(40) NOT NULL,
    scenario            VARCHAR(32) NOT NULL,
    status              VARCHAR(24) NOT NULL CHECK (status IN ('CAPTURED', 'FAILED', 'TIMEOUT')),
    transaction_ref     VARCHAR(80),
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
    id                  BIGSERIAL PRIMARY KEY,
    ticket_number       VARCHAR(32) UNIQUE NOT NULL,
    pnr_code            VARCHAR(10) NOT NULL,
    booking_reference   VARCHAR(48) NOT NULL REFERENCES bookings(booking_reference) ON DELETE CASCADE,
    id_account          BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    id_flight           BIGINT NOT NULL REFERENCES flights(id) ON DELETE RESTRICT,
    id_airline          BIGINT NOT NULL REFERENCES airlines(id) ON DELETE RESTRICT,
    passenger_name      VARCHAR(180) NOT NULL,
    seat_codes          TEXT NOT NULL,
    cabin_class         VARCHAR(24) NOT NULL,
    baggage_allowance   VARCHAR(120) NOT NULL,
    verification_token  VARCHAR(96) UNIQUE NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'CANCELLED', 'REFUNDED')),
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_travelers (
    id                      BIGSERIAL PRIMARY KEY,
    id_account              BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title                   VARCHAR(16) DEFAULT 'MR',
    first_name              VARCHAR(100) NOT NULL,
    last_name               VARCHAR(100) NOT NULL,
    date_of_birth           DATE,
    gender                  VARCHAR(20),
    nationality             VARCHAR(80) DEFAULT 'BD',
    document_type           VARCHAR(24) DEFAULT 'passport',
    document_number_masked  VARCHAR(32),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refund_requests (
    id                  BIGSERIAL PRIMARY KEY,
    booking_reference   VARCHAR(48) NOT NULL REFERENCES bookings(booking_reference) ON DELETE CASCADE,
    id_account          BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    id_airline          BIGINT NOT NULL REFERENCES airlines(id) ON DELETE RESTRICT,
    reason              TEXT NOT NULL,
    requested_amount    NUMERIC(12,2) NOT NULL,
    approved_amount     NUMERIC(12,2) DEFAULT 0,
    status              VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by         BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    review_note         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(64) NOT NULL,
    result          VARCHAR(32) NOT NULL,
    actor_id        BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    actor_role      VARCHAR(24),
    id_airline      BIGINT REFERENCES airlines(id) ON DELETE SET NULL,
    flight_id       BIGINT,
    seat_codes      TEXT,
    reservation_ref VARCHAR(48),
    details         TEXT,
    ip_address      VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_airline_time ON audit_logs (id_airline, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (created_at DESC);
