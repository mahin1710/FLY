import urllib.request
import urllib.parse
import json
import sys

BASE_URL = 'http://127.0.0.1:5000'

def test_endpoint(name, url, expected_status=200, check_json=False):
    print(f"Testing {name}: {url}")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            status = resp.getcode()
            assert status == expected_status, f"Expected {expected_status}, got {status}"
            body = resp.read().decode('utf-8')
            if check_json:
                data = json.loads(body)
                return data
            return body
    except Exception as e:
        print(f"FAILED {name}: {e}")
        raise e

def run_all_checks():
    print("==================================================")
    print("VERIFYING FLIGHT SEARCH UPGRADE & TRIP TYPES")
    print("==================================================")

    # 1. Page route /flight/list
    html = test_endpoint("Flight List Page Route", f"{BASE_URL}/flight/list")
    assert '<!DOCTYPE html>' in html or '<html' in html
    assert 'FLY' in html
    print("  -> Passed: /flight/list returns HTML correctly.")

    # 2. Airport Autocomplete API (Empty query -> top airports)
    top_airports = test_endpoint("Airports Top/Default Search", f"{BASE_URL}/api/airports/search?q=", check_json=True)
    assert isinstance(top_airports, list) and len(top_airports) > 0
    iata_codes = [a.get('IATA') for a in top_airports]
    print(f"  -> Top airport IATAs returned: {iata_codes[:6]}")
    assert 'DAC' in iata_codes, "DAC must be in top airports"
    print("  -> Passed: /api/airports/search returns real database airports.")

    # 3. Airport Autocomplete API (Search by code 'DAC')
    dac_res = test_endpoint("Airport Search by IATA 'DAC'", f"{BASE_URL}/api/airports/search?q=DAC", check_json=True)
    assert len(dac_res) > 0
    assert dac_res[0]['IATA'] == 'DAC'
    print(f"  -> Found: {dac_res[0]['name']}, {dac_res[0]['city']} ({dac_res[0]['IATA']})")

    # 4. Airport Autocomplete API (Search by city name "Cox's Bazar")
    cxb_res = test_endpoint("Airport Search by City 'Cox'", f"{BASE_URL}/api/airports/search?q=Cox", check_json=True)
    assert len(cxb_res) > 0
    assert any(a.get('IATA') == 'CXB' for a in cxb_res)
    print(f"  -> Found: {[a['city'] + ' (' + a['IATA'] + ')' for a in cxb_res]}")

    # 5. Airport Autocomplete API (Search by city name "Chittagong")
    cgp_res = test_endpoint("Airport Search by City 'Chittagong'", f"{BASE_URL}/api/airports/search?q=Chittagong", check_json=True)
    assert len(cgp_res) > 0
    assert any(a.get('IATA') == 'CGP' for a in cgp_res)
    print(f"  -> Found: {[a['city'] + ' (' + a['IATA'] + ')' for a in cgp_res]}")

    # 6. Flight Search API
    flights_res = test_endpoint("Flight Search API", f"{BASE_URL}/api/flights?depCity=DAC&arrCity=CXB", check_json=True)
    assert 'total' in flights_res and 'flights' in flights_res
    print(f"  -> Found {flights_res['total']} flights from DAC to CXB")
    if flights_res['flights']:
        f0 = flights_res['flights'][0]
        print(f"  -> Sample flight: {f0['flightNumber']} ({f0['depIATA']} -> {f0['arrIATA']}) Price: {f0['economy_price']} Status: {f0['flightStatus']}")

    # 7. Trip Type 1: One Way URL
    url_oneway = f"{BASE_URL}/flight/list?trip_type=one_way&from=DAC&to=CXB&departure=2026-11-29&adults=1&children=0&infants=0&cabin=Economy"
    html_oneway = test_endpoint("One Way Search URL", url_oneway)
    assert 'search-widget-card' in html_oneway
    print("  -> Passed: One Way flight search URL served successfully.")

    # 8. Trip Type 2: Round Trip URL
    url_roundtrip = f"{BASE_URL}/flight/list?trip_type=round_trip&from=DAC&to=CXB&departure=2026-11-29&return=2026-12-05&adults=2&children=1&infants=0&cabin=Economy"
    html_roundtrip = test_endpoint("Round Trip Search URL", url_roundtrip)
    assert 'search-widget-card' in html_roundtrip
    print("  -> Passed: Round Trip flight search URL served successfully.")

    # 9. Trip Type 3: Multi City URL
    url_multicity = f"{BASE_URL}/flight/list?trip_type=multi_city&from1=DAC&to1=CGP&departure1=2026-11-29&from2=CGP&to2=CXB&departure2=2026-11-30&adults=1&children=0&infants=0&cabin=Economy"
    html_multicity = test_endpoint("Multi City Search URL", url_multicity)
    assert 'search-widget-card' in html_multicity
    print("  -> Passed: Multi City flight search URL served successfully.")

    print("\n==================================================")
    print("ALL FLIGHT SEARCH UPGRADE CHECKS PASSED (100%)")
    print("==================================================")

if __name__ == '__main__':
    run_all_checks()
