import time
from playwright.sync_api import sync_playwright, expect

def verify_checkmarks():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        context_a = browser.new_context()
        page_a = context_a.new_page()

        context_b = browser.new_context()
        page_b = context_b.new_page()

        # 1. Register User A
        print("Registering User A...")
        page_a.goto("http://localhost:25577")

        if page_a.is_visible("#loginForm") and not page_a.is_visible("#registerForm"):
             page_a.click("#showRegister")
             time.sleep(0.5)

        page_a.fill("#registerForm input[name='regUsername']", "userA")
        page_a.fill("#registerForm input[name='regDisplayName']", "User A")
        page_a.fill("#registerForm input[name='regPassword']", "password")

        # Handle registration alert
        page_a.on("dialog", lambda dialog: dialog.accept())

        page_a.click("#registerForm button[type='submit']")
        time.sleep(1)

        # Login A
        print("Logging in User A...")
        page_a.goto("http://localhost:25577")
        if page_a.is_visible("#registerForm"):
             page_a.click("#showLogin")
             time.sleep(0.5)

        page_a.fill("#loginForm input[name='username']", "userA")
        page_a.fill("#loginForm input[name='password']", "password")
        page_a.click("#loginForm button[type='submit']")
        page_a.wait_for_url("**/app.html")
        page_a.wait_for_selector("#userUsername")
        print("User A logged in.")

        # 2. Register User B
        print("Registering User B...")
        page_b.goto("http://localhost:25577")

        if page_b.is_visible("#loginForm") and not page_b.is_visible("#registerForm"):
             page_b.click("#showRegister")
             time.sleep(0.5)

        page_b.fill("#registerForm input[name='regUsername']", "userB")
        page_b.fill("#registerForm input[name='regDisplayName']", "User B")
        page_b.fill("#registerForm input[name='regPassword']", "password")

        page_b.on("dialog", lambda dialog: dialog.accept())
        page_b.click("#registerForm button[type='submit']")
        time.sleep(1)

        # Login B
        print("Logging in User B...")
        page_b.goto("http://localhost:25577")
        if page_b.is_visible("#registerForm"):
             page_b.click("#showLogin")
             time.sleep(0.5)

        page_b.fill("#loginForm input[name='username']", "userB")
        page_b.fill("#loginForm input[name='password']", "password")
        page_b.click("#loginForm button[type='submit']")
        page_b.wait_for_url("**/app.html")
        page_b.wait_for_selector("#userUsername")
        print("User B logged in.")

        # 3. Friend Request
        page_a.click("#addFriendBtn")
        page_a.fill("#friendSearchInput", "userB")
        page_a.click("#searchUserBtn")

        try:
            page_a.wait_for_selector(".search-result-item button", timeout=3000)
            page_a.click(".search-result-item button")
            print("User A sent request.")

            time.sleep(2)
            # B accepts
            page_b.reload()
            try:
                page_b.wait_for_selector(".friend-request-item .btn-primary", timeout=5000)
                page_b.click(".friend-request-item .btn-primary")
                print("User B accepted.")
            except:
                print("B didn't see request or already friends.")

        except:
            print("User B not found or error.")

        time.sleep(2)

        # 4. Start Chat
        try:
            page_a.wait_for_selector(".friend-item[data-username='userB']", timeout=5000)
            page_a.click(".friend-item[data-username='userB']")
            print("User A selected User B.")
        except:
            print("Friend not found in list for A. Maybe need refresh.")
            page_a.reload()
            page_a.wait_for_selector(".friend-item[data-username='userB']")
            page_a.click(".friend-item[data-username='userB']")

        page_a.wait_for_selector("#messages")

        # 5. Send Message
        page_a.fill("#messageInput", "Hello Checkmark")
        page_a.click("#sendBtn")
        print("User A sent message.")

        time.sleep(2)

        # Capture Step 1: Delivered (Grey double tick)
        page_a.screenshot(path="verification/step1_delivered.png")
        print("Captured step1_delivered.png")

        # 6. B reads message
        try:
             page_b.wait_for_selector(".friend-item[data-username='userA']", timeout=5000)
             page_b.click(".friend-item[data-username='userA']")
             print("User B opened chat.")
        except:
             page_b.reload()
             page_b.wait_for_selector(".friend-item[data-username='userA']")
             page_b.click(".friend-item[data-username='userA']")

        time.sleep(2)

        # Capture Step 2: Read (Green double tick)
        page_a.screenshot(path="verification/step2_read.png")
        print("Captured step2_read.png")

        browser.close()

if __name__ == "__main__":
    verify_checkmarks()
