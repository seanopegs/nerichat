from playwright.sync_api import sync_playwright, expect
import time

def verify_app(page):
    # 1. Login
    # The server is running on port 25577
    page.goto("http://localhost:25577")

    # Setup local storage with a mock user
    user_data = {
        "username": "testuser",
        "displayName": "Test User",
        "avatar": "https://ui-avatars.com/api/?name=Test+User",
        "theme": "light",
        "pinned_chats": []
    }
    # We need to set localStorage BEFORE the page logic redirects to login.
    # But if we just goto root, it redirects to /.
    # Let's set it and reload.
    page.evaluate(f"localStorage.setItem('chatUser', '{str(user_data).replace('True', 'true').replace('False', 'false').replace('None', 'null').replace('\'', '\"')}')")
    page.goto("http://localhost:25577/app.html")

    # Wait for app to load
    expect(page.locator("#userDisplayName")).to_have_text("Test User", timeout=10000)

    # 2. Check User Profile Modal (View Profile)
    # We need to mock a friend in the list to click 'View Profile'
    page.evaluate("""
        const friendsList = document.getElementById('friendsContainer');
        const div = document.createElement('div');
        div.className = 'friend-item';
        div.setAttribute('data-username', 'friend1');
        div.innerHTML = `
            <div style="position:relative;">
                <img src="https://ui-avatars.com/api/?name=Friend+One" style="width:36px;height:36px;border-radius:50%">
                <span class="status-indicator status-online"></span>
            </div>
            <span>Friend One</span>
        `;

        // Manually trigger the context menu logic or just inject the menu
        // Since we can't easily access internal functions, we will just verify the Modal element exists and is styled.
        // Actually, we can just open the modal manually to screenshot it.

        // But wait, we modified `renderGroups` to show avatars. Let's verify that.
    """)

    # Verify Group Settings Modal (Modified to be "premium")
    # Create a mock group in the list
    page.evaluate("""
        const groupsList = document.getElementById('groupsList');
        const div = document.createElement('div');
        div.className = 'group-item';
        div.innerHTML = `<img src="https://ui-avatars.com/api/?name=Test+Group" style="width:36px;height:36px;border-radius:50%; margin-right: 5px;"> Test Group`;

        // Mock click to open group info
        div.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const modal = document.getElementById('groupInfoModal');
            document.getElementById('infoGroupName').textContent = "Test Group";
            document.getElementById('infoGroupId').textContent = "12345-abcde";
            document.getElementById('infoGroupAvatar').src = "https://ui-avatars.com/api/?name=Test+Group";
            modal.classList.remove('hidden');
        });
        groupsList.appendChild(div);
    """)

    # Double click the mock group to open settings
    page.locator(".group-item").dblclick()
    time.sleep(1)
    page.screenshot(path="/home/jules/verification/group_settings.png")

    # Close modal
    page.locator(".close-modal-info").click()

    # 3. Test User Settings Page
    page.locator(".user-profile").click()
    expect(page).to_have_url("http://localhost:25577/settings.html")
    time.sleep(1)

    # Screenshot Settings Page
    page.screenshot(path="/home/jules/verification/user_settings.png")

    # 4. Test View Profile Modal
    # Since we are on settings page, go back
    page.goto("http://localhost:25577/app.html")

    # Manually trigger profile modal to verify style
    page.evaluate("""
        const modal = document.getElementById('userProfileModal');
        document.getElementById('profileModalAvatar').src = "https://ui-avatars.com/api/?name=Friend+One";
        document.getElementById('profileModalName').textContent = "Friend One";
        document.getElementById('profileModalUsername').textContent = "@friend1";

        const statusEl = document.getElementById('profileModalStatus');
        statusEl.textContent = 'Online';
        statusEl.style.color = 'var(--success)';
        statusEl.style.border = '1px solid var(--success)';
        statusEl.style.background = 'rgba(16, 185, 129, 0.1)';

        modal.classList.remove('hidden');
    """)
    time.sleep(1)
    page.screenshot(path="/home/jules/verification/profile_modal.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_app(page)
        finally:
            browser.close()
