
from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_chat_app(page: Page):
    page.goto("http://localhost:25577/")

    # Register
    page.click("#showRegister")
    page.fill("input[name='regUsername']", "testuser_sqlite4") # New user
    page.fill("input[name='regDisplayName']", "Test SQLite4")
    page.fill("input[name='regPassword']", "password")

    # Handle alert
    def handle_dialog(dialog):
        print(f"Alert: {dialog.message}")
        dialog.accept()
    page.on("dialog", handle_dialog)

    page.click("#registerForm button[type='submit']")

    time.sleep(2) # Wait for alert and UI switch

    # Login
    page.fill("input[name='username']", "testuser_sqlite4")
    page.fill("input[name='password']", "password")
    page.click("#loginForm button[type='submit']")

    # Expect redirect to app.html
    expect(page).to_have_url("http://localhost:25577/app.html", timeout=5000)

    # Check if user info is displayed
    expect(page.locator("#userUsername")).to_contain_text("@testuser_sqlite4")

    # Take screenshot of App
    page.screenshot(path="/home/jules/verification/app_view.png")

    # Test Sidebar Toggle
    page.click("#sidebarToggleBtn")
    time.sleep(1)
    page.screenshot(path="/home/jules/verification/app_sidebar_collapsed.png")

    # Test Persistence Redirect
    page.goto("http://localhost:25577/")
    expect(page).to_have_url("http://localhost:25577/app.html", timeout=5000)
    print("Persistence redirect verified")

    print("Logged in successfully and verified UI.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_chat_app(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()
