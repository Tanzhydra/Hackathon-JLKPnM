// Variabel Sesi Global
let currentUser = { role: 'mahasiswa', loggedIn: false };
let isUiActive = true; 

// ==========================================
// FUNGSI NAVIGASI LIFT GLOBAL
// ==========================================
function goToRoom1() {
    document.getElementById('lift-ui').classList.add('hidden');
    isUiActive = false;
    window.game.scene.getScene('LobbyScene').scene.start('Room1');
    returnGameFocus();
}

function goToLobby() {
    document.getElementById('lift-ui').classList.add('hidden');
    isUiActive = false;
    alert("Anda sudah berada di Lantai 1 (Lobi Utama).");
    returnGameFocus();
}

function closeLift() {
    document.getElementById('lift-ui').classList.add('hidden');
    isUiActive = false;
    returnGameFocus();
}

function returnGameFocus() {
    setTimeout(() => {
        const canvas = document.querySelector('#game-container canvas');
        if (canvas) canvas.focus();
    }, 100);
}


// ==========================================
// 1. SCENE LOBI UTAMA (Lantai 1)
// ==========================================
class LobbyScene extends Phaser.Scene {
    constructor() { super('LobbyScene'); }

    preload() {
        this.load.image('player-depan', 'assets/avatar depan.png');
        this.load.image('player-belakang', 'assets/ava belakang.png');
        this.load.image('player-kiri', 'assets/ava kiri.png');
        this.load.image('player-kanan', 'assets/ava kanan.png');
        this.load.image('loby-bg', 'assets/Lobby_Background.png');
        this.load.tilemapTiledJSON('loby-map', 'assets/Loby.tmj');
    }

    create() {
        const map = this.make.tilemap({ key: 'loby-map' });
        const scaleFactor = 0.6; 
        const offsetX = (1280 - (1536 * scaleFactor)) / 2;
        const offsetY = (720 - (1024 * scaleFactor)) / 2;

        this.bg = this.add.image(offsetX, offsetY, 'loby-bg');
        this.bg.setOrigin(0, 0);
        this.bg.setScale(scaleFactor);

        const collisionObjects = map.getObjectLayer('collision');
        this.obstacles = this.physics.add.staticGroup();
        if (collisionObjects) {
            collisionObjects.objects.forEach(object => {
                const objX = offsetX + (object.x * scaleFactor);
                const objY = offsetY + (object.y * scaleFactor);
                const objW = object.width * scaleFactor;
                const objH = object.height * scaleFactor;
                const obstacle = this.add.rectangle(objX, objY, objW, objH, 0xff0000, 0);
                obstacle.setOrigin(0, 0);
                this.physics.add.existing(obstacle, true);
                this.obstacles.add(obstacle);
            });
        }

        const spawnX = offsetX + (1536 * scaleFactor) / 2;
        const spawnY = offsetY + (1024 * scaleFactor) - 100;
        
        this.player = this.physics.add.sprite(spawnX, spawnY, 'player-belakang');
        this.player.setScale(0.12 * scaleFactor); 
        
        const sW = this.player.width, sH = this.player.height;
        this.player.body.setSize(sW * 0.05, sH * 0.05);
        this.player.body.setOffset((sW - sW * 0.4) / 2, sH - (sH * 0.15) - 10);
        this.player.body.setCollideWorldBounds(true);
        this.physics.add.collider(this.player, this.obstacles);

        this.receptionZone = this.add.zone(offsetX + (760 * scaleFactor), offsetY + (450 * scaleFactor), 150, 120);
        this.physics.add.existing(this.receptionZone, true);

        this.liftZone = this.add.zone(offsetX + (1100 * scaleFactor), offsetY + (270 * scaleFactor), 150, 150);
        this.physics.add.existing(this.liftZone, true);

        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D
        });
        
        initHtmlUiEvents(this);
    }

    update() {
        if (isUiActive || !currentUser.loggedIn) {
            if (this.player && this.player.body) this.player.body.setVelocity(0);
            return;
        }

        const speed = 250;
        this.player.body.setVelocity(0);

        if (this.cursors.left.isDown || this.wasd.left.isDown) {
            this.player.body.setVelocityX(-speed);
            this.player.setTexture('player-kiri');
        } else if (this.cursors.right.isDown || this.wasd.right.isDown) {
            this.player.body.setVelocityX(speed);
            this.player.setTexture('player-kanan');
        } else if (this.cursors.up.isDown || this.wasd.up.isDown) {
            this.player.body.setVelocityY(-speed);
            this.player.setTexture('player-belakang');
        } else if (this.cursors.down.isDown || this.wasd.down.isDown) {
            this.player.body.setVelocityY(speed);
            this.player.setTexture('player-depan');
        }

        const btnReception = document.getElementById('btn-interact-reception');
        const btnLift = document.getElementById('btn-interact-lift');

        if (currentUser.role === 'mahasiswa' && this.physics.overlap(this.player, this.receptionZone)) {
            btnReception.classList.remove('hidden');
        } else {
            btnReception.classList.add('hidden');
        }

        if (currentUser.role === 'pegawai' && this.physics.overlap(this.player, this.liftZone)) {
            btnLift.classList.remove('hidden');
        } else {
            btnLift.classList.add('hidden');
        }
    }
}


// ==========================================
// 2. SCENE ROOM 1 (Tanpa Spasi - Lantai 2)
// ==========================================
class Room1 extends Phaser.Scene {
    constructor() { super('Room1'); }

    preload() {
        this.load.image('room1-bg', 'assets/room1.png');
        this.load.tilemapTiledJSON('room1-map', 'assets/Room1.tmj');
    }

    create() {
        const map = this.make.tilemap({ key: 'room1-map' });
        const scaleFactor = 0.6; 
        const offsetX = (1280 - (1536 * scaleFactor)) / 2;
        const offsetY = (720 - (1024 * scaleFactor)) / 2;

        this.bg = this.add.image(offsetX, offsetY, 'room1-bg');
        this.bg.setOrigin(0, 0);
        this.bg.setScale(scaleFactor);

        const collisionObjects = map.getObjectLayer('Collision 2');
        this.obstacles = this.physics.add.staticGroup();
        if (collisionObjects) {
            collisionObjects.objects.forEach(object => {
                const objX = offsetX + (object.x * scaleFactor);
                const objY = offsetY + (object.y * scaleFactor);
                const objW = object.width * scaleFactor;
                const objH = object.height * scaleFactor;
                const obstacle = this.add.rectangle(objX, objY, objW, objH, 0xff0000, 0);
                obstacle.setOrigin(0, 0);
                this.physics.add.existing(obstacle, true);
                this.obstacles.add(obstacle);
            });
        }

        this.player = this.physics.add.sprite(offsetX + 400, offsetY + 500, 'player-depan');
        this.player.setScale(0.12 * scaleFactor); 
        
        const sW = this.player.width, sH = this.player.height;
        this.player.body.setSize(sW * 0.4, sH * 0.15);
        this.player.body.setOffset((sW - sW * 0.4) / 2, sH - (sH * 0.15) - 10);
        this.player.body.setCollideWorldBounds(true);
        this.physics.add.collider(this.player, this.obstacles);

        // ZONA MEJA KERJA: Dipindah pas ke meja kanan bawah yang kosong
        this.deskZone = this.add.zone(offsetX + (650 * scaleFactor), offsetY + (620 * scaleFactor), 140, 120);
        this.physics.add.existing(this.deskZone, true);

        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D
        });
    }

    update() {
        if (isUiActive) {
            this.player.body.setVelocity(0);
            return;
        }

        const speed = 250;
        this.player.body.setVelocity(0);

        if (this.cursors.left.isDown || this.wasd.left.isDown) {
            this.player.body.setVelocityX(-speed);
            this.player.setTexture('player-kiri');
        } else if (this.cursors.right.isDown || this.wasd.right.isDown) {
            this.player.body.setVelocityX(speed);
            this.player.setTexture('player-kanan');
        } else if (this.cursors.up.isDown || this.wasd.up.isDown) {
            this.player.body.setVelocityY(-speed);
            this.player.setTexture('player-belakang');
        } else if (this.cursors.down.isDown || this.wasd.down.isDown) {
            this.player.body.setVelocityY(speed);
            this.player.setTexture('player-depan');
        }

        const btnWorker = document.getElementById('btn-interact-worker');
        if (this.physics.overlap(this.player, this.deskZone)) {
            btnWorker.classList.remove('hidden');
        } else {
            btnWorker.classList.add('hidden');
        }
    }
}


// ==========================================
// 3. EVENT LISTENER UNTUK HTML FORM
// ==========================================
function initHtmlUiEvents(sceneInstance) {
    document.getElementById('btn-submit-signup').onclick = () => {
        alert("Pendaftaran akun berhasil! Silakan Sign In.");
        document.getElementById('signup-screen').classList.add('hidden');
        document.getElementById('signin-screen').classList.remove('hidden');
    };

    document.getElementById('btn-submit-signin').onclick = () => {
        const roleVal = document.getElementById('login-role').value; 
        currentUser.role = roleVal;
        currentUser.loggedIn = true;
        isUiActive = false; 

        document.getElementById('signin-screen').classList.add('hidden');
        
        const mainWrapper = document.getElementById('main-wrapper');
        mainWrapper.style.backgroundImage = 'none'; 
        mainWrapper.style.backgroundColor = '#0b0f19'; 

        document.getElementById('game-container').classList.remove('hidden');
        
        returnGameFocus();
    };

    document.getElementById('btn-upload-submit').onclick = () => {
        const fileInput = document.getElementById('file-form14');
        if (fileInput.files.length === 0) {
            alert("Harap unggah scan Form 14 terlebih dahulu!");
            return;
        }
        alert("Form 14 berhasil diunggah! Sistem AI OCR sedang memproses ekstraksi.");
        document.getElementById('receptionist-ui').classList.add('hidden');
        isUiActive = false; 
        returnGameFocus();
    };
    
    document.getElementById('btn-close-receptionist').onclick = () => {
        document.getElementById('receptionist-ui').classList.add('hidden');
        isUiActive = false;
        returnGameFocus();
    };
}

// ==========================================
// KONFIGURASI DAN INSTANSIASI GAME PHASER
// ==========================================
const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 }, debug: true } // Ubah ke true jika ingin tes collider kembali
    },
    scene: [LobbyScene, Room1]
};

window.game = new Phaser.Game(config);