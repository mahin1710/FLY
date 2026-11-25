-- ============================================================================
-- FLY FLIGHT BOOKING SYSTEM — REPEATABLE POSTGRESQL SEED DATA
-- Safe to re-run (ON CONFLICT DO NOTHING)
-- ============================================================================

INSERT INTO airlines (id, name, iata, icao) VALUES
    (839, 'Biman Bangladesh Airlines', 'BG', 'BBC'),
    (371, 'US-Bangla Airlines', 'BS', 'UBG'),
    (396, 'Emirates', 'EK', 'UAE')
ON CONFLICT DO NOTHING;

INSERT INTO airports (name, type, iata, icao, city, country, iso_country) VALUES
    ('Hazrat Shahjalal International Airport', 'large_airport', 'DAC', 'VGHS', 'Dhaka', 'Bangladesh', 'BD'),
    ('Cox''s Bazar Airport', 'medium_airport', 'CXB', 'VGCB', 'Cox''s Bazar', 'Bangladesh', 'BD'),
    ('Shah Amanat International Airport', 'medium_airport', 'CGP', 'VGEG', 'Chittagong', 'Bangladesh', 'BD'),
    ('Osmany International Airport', 'medium_airport', 'ZYL', 'VGSY', 'Sylhet', 'Bangladesh', 'BD'),
    ('Dubai International Airport', 'large_airport', 'DXB', 'OMDB', 'Dubai', 'United Arab Emirates', 'AE')
ON CONFLICT (iata) DO NOTHING;

INSERT INTO baggage_policies (id_airline, route_scope, included_checked_kg, included_pieces, cabin_kg, extra_per_kg_fee, extra_piece_fee) VALUES
    (NULL, 'DOMESTIC', 23, 1, 7, 120.00, 350.00),
    (NULL, 'INTERNATIONAL', 40, 2, 7, 250.00, 1200.00)
ON CONFLICT (id_airline, route_scope) DO NOTHING;

INSERT INTO promo_codes (code, discount_type, discount_value, min_fare, max_discount, usage_limit, is_active) VALUES
    ('FLY10', 'PERCENT', 10.00, 2000.00, 5000.00, 5000, TRUE),
    ('DHAKA500', 'FIXED', 500.00, 3500.00, 500.00, 2000, TRUE)
ON CONFLICT (code) DO NOTHING;
