
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to app
        page.goto("http://localhost:25577/")

        # Wait for login form
        page.wait_for_selector("#loginForm", timeout=5000)

        # Register (to ensure user exists) - Click "Register" link first
        page.click("#showRegister")
        page.wait_for_selector("#registerForm")

        page.fill("input[name='regUsername']", "testuser1")
        page.fill("input[name='regDisplayName']", "Test User")
        page.fill("input[name='regPassword']", "password")

        # Handle potential "User already exists" alert
        page.on("dialog", lambda dialog: dialog.accept())

        try:
            page.click("#registerForm button[type='submit']")
            # If registration succeeds, it redirects or logs in.
            # If fails (exists), we switch to login.

            try:
                page.wait_for_url("**/app.html", timeout=2000)
            except:
                # Maybe user exists, try login
                page.click("#showLogin")
                page.fill("input[name='username']", "testuser1")
                page.fill("input[name='password']", "password")
                page.click("#loginForm button[type='submit']")
                page.wait_for_url("**/app.html", timeout=5000)

        except Exception as e:
            print(f"Login/Register flow issue: {e}")
            # Try direct login just in case
            page.goto("http://localhost:25577/")
            page.fill("input[name='username']", "testuser1")
            page.fill("input[name='password']", "password")
            page.click("#loginForm button[type='submit']")
            page.wait_for_url("**/app.html", timeout=5000)


        # Wait for dashboard
        page.wait_for_selector("#userDisplayName", timeout=5000)

        # Create a group if list is empty (or always create one for testing)
        page.click("#createGroupBtn")
        page.fill("#groupNameInput", "Test Group")
        page.click("#submitCreateGroup")

        # Wait for group to appear
        page.wait_for_selector(".group-item", timeout=5000)

        # Right click group to show context menu (Pin)
        group = page.locator(".group-item").first
        group.click(button="right")
        page.wait_for_selector(".context-menu")

        # Screenshot 1: Group Context Menu
        page.screenshot(path="verification/1_group_context.png")

        # Close context menu
        page.click("body")

        # Send a message
        page.fill("#messageInput", "Hello World")
        page.click("#sendBtn")
        page.wait_for_selector(".message.me")

        # Right click message to show Reply/SeenBy
        msg = page.locator(".message-content").last
        msg.click(button="right")
        page.wait_for_selector(".context-menu")

        # Screenshot 2: Message Context Menu
        page.screenshot(path="verification/2_message_context.png")

        # Click "Seen by" (might fail if text is different)
        # The text is "Seen by" with icon
        page.locator(".context-menu div").filter(has_text="Seen by").click()
        page.wait_for_selector(".modal-header")

        # Screenshot 3: Seen By Modal
        page.screenshot(path="verification/3_seen_by_modal.png")

        # Close modal
        page.locator(".close-modal").last.click()

        # Reply flow
        msg.click(button="right")
        page.locator(".context-menu div").filter(has_text="Reply").click()

        # Screenshot 4: Reply Banner
        page.screenshot(path="verification/4_reply_banner.png")

        browser.close()

if __name__ == "__main__":
    run()
