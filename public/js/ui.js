// Manage UI screens and simple popup modals
const UI = {
    screens: {
        menu: document.getElementById('screen-menu'),
        lobby: document.getElementById('screen-lobby'),
        game: document.getElementById('screen-game'),
        roundEnd: document.getElementById('screen-round-end'),
        matchEnd: document.getElementById('screen-match-end')
    },
    errorPopup: document.getElementById('popup-error'),
    errorMessage: document.getElementById('error-message'),
    errorClose: document.getElementById('btn-error-close'),

    init() {
        // Close error popup on button click
        this.errorClose.addEventListener('click', () => {
            this.errorPopup.classList.remove('active');
        });

        // Load saved name
        const savedName = localStorage.getItem('dont_push_me_name');
        if (savedName) {
            document.getElementById('input-name').value = savedName;
        }
    },

    showScreen(screenKey) {
        // Deactivate all screens
        Object.keys(this.screens).forEach(key => {
            const screen = this.screens[key];
            if (screen) {
                screen.classList.remove('active');
            }
        });

        // Activate target screen
        const target = this.screens[screenKey];
        if (target) {
            target.classList.add('active');
        }
    },

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorPopup.classList.add('active');
    },

    saveName(name) {
        if (name) {
            localStorage.setItem('dont_push_me_name', name);
        }
    }
};

// Initialize UI helpers on script load
UI.init();
window.UI = UI;
