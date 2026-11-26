"""
FLY — UI Pages, Referenced Assets, Responsive Rules & Legacy Removal Verification
Verifies every active page renders 200 OK without broken scripts, stylesheets, or legacy artifacts.
"""

import os
import re
import unittest
import urllib.request
import urllib.error

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")

PAGES = [
    "/",
    "/flights/search",
    "/hotels/search",
    "/cars/search",
    "/flights/976/seats",
    "/checkout",
    "/login",
    "/register",
    "/profile",
    "/my-bookings",
    "/manage-booking",
    "/support",
    "/payment/result",
    "/admin",
    "/admin/flights",
    "/admin/bookings",
    "/admin/inventory",
    "/admin/audit-logs",
    "/admin/settings",
    "/ticket/A7K9P2",
    "/ticket/verify/TEST",
]

LEGACY_ASSETS = (
    "checkout_store.js",
    "flight_fixtures.js",
    "flight_models.js",
    "demo_notice",
    "Simulated schedule",
)


def fetch_text(path):
    req = urllib.request.Request(BASE_URL + path, method="GET")
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.status, r.read().decode("utf-8", "ignore")


class UiAssetsAndPagesTests(unittest.TestCase):
    def test_01_all_pages_and_referenced_static_assets_return_200(self):
        checked_assets = set()
        for page in PAGES:
            st, html = fetch_text(page)
            self.assertEqual(st, 200, f"Page {page} returned {st}")
            self.assertIn("<!DOCTYPE html>", html[:200], f"{page} missing DOCTYPE")
            self.assertIn("/js/api_client.js", html, f"{page} missing centralized api_client.js")
            self.assertIn("/js/shell.js", html, f"{page} missing shell.js")

            for legacy in LEGACY_ASSETS:
                self.assertNotIn(legacy, html, f"Legacy artifact '{legacy}' leaked into {page}")

            # Verify every /js/* and /css/* asset actually resolves 200 OK
            for match in re.findall(r'(?:src|href)=["\'](/(?:js|css|images)/[^"\'?#]+)', html):
                if match in checked_assets:
                    continue
                try:
                    req = urllib.request.Request(BASE_URL + match, method="GET")
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        self.assertEqual(resp.status, 200, f"Broken static asset {match} on {page}")
                    checked_assets.add(match)
                except urllib.error.HTTPError as e:
                    self.fail(f"Static asset {match} returned {e.code} (referenced in {page})")

    def test_02_responsive_css_breakpoints_present(self):
        st, css = fetch_text("/css/style.css")
        self.assertEqual(st, 200)
        self.assertIn("@media (max-width:", css)
        self.assertIn("@media print", css)
        self.assertIn(".seat-map-layout", css)
        self.assertIn("--header-height: 58px", css)
        self.assertIn("flyHeroTextReveal", css)
        self.assertIn("flySearchPanelFloatUp", css)
        self.assertIn("prefers-reduced-motion: reduce", css)

    def test_03_homepage_hero_structure_and_copy(self):
        st, html = fetch_text("/")
        self.assertEqual(st, 200)
        self.assertIn("hero-backdrop-frame", html)
        self.assertIn("FLY BEYOND BORDERS &bull; GLOBAL FLIGHT NETWORK", html)
        self.assertIn("Fly Beyond Borders", html)
        self.assertIn("Discover destinations, compare flights, and enjoy a simpler way to travel.", html)
        # Ensure floating search panel sits before Popular Destinations and feature strip box is removed
        self.assertNotIn("heroFeatureStrip", html)
        self.assertNotIn("Best Price Guarantee", html)
        self.assertLess(html.index("searchWidgetContainer"), html.index("popular-destinations-section"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
