class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    preload() {
        // 1. Muat aset
        this.load.image('player-depan', 'assets/avatar depan.png');
        this.load.image('player-belakang', 'assets/ava belakang.png');
        this.load.image('player-kiri', 'assets/ava kiri.png');
        this.load.image('player-kanan', 'assets/ava kanan.png');

        // Pastikan nama file map dan background sesuai
        this.load.tilemapTiledJSON('map', 'assets/Loby.tmj'); 
        this.load.image('background-kantor', 'assets/Lobby_Background.png');
    }

    create() {
        const map = this.make.tilemap({ key: 'map' });

        // 2. Skala Background & Map (agar pas di tengah kanvas)
        const scaleFactor = 0.6; 
        
        // Asumsi ukuran asli background 1536x1024
        const offsetX = (1280 - (1536 * scaleFactor)) / 2;
        const offsetY = (720 - (1024 * scaleFactor)) / 2;

        // 3. Tampilkan Background
        this.bg = this.add.image(offsetX, offsetY, 'background-kantor');
        this.bg.setOrigin(0, 0); 
        this.bg.setScale(scaleFactor);

        // 4. Proses Objek Collision (Tembok & Meja) dari Tiled
        const collisionObjects = map.getObjectLayer('collision');
        this.obstacles = this.physics.add.staticGroup();

        if (collisionObjects) {
            collisionObjects.objects.forEach(object => {
                const objX = offsetX + (object.x * scaleFactor);
                const objY = offsetY + (object.y * scaleFactor);
                const objW = object.width * scaleFactor;
                const objH = object.height * scaleFactor;

                // Kotak merah transparan untuk tembok (ubah alpha 0.5 ke 0 kalau sudah rilis)
                const obstacle = this.add.rectangle(objX, objY, objW, objH, 0xff0000, 0.5);
                obstacle.setOrigin(0, 0); 
                
                this.physics.add.existing(obstacle, true); 
                this.obstacles.add(obstacle);
            });
        } else {
            console.error("ERROR: Layer 'collision' tidak ditemukan di file .tmj!");
        }

        // 5. INISIALISASI LOKASI SPAWN PLAYER
        // Menaruh player di area pintu masuk bawah (bukan di tengah layar)
        const spawnX = offsetX + (1536 * scaleFactor) / 2; // Berada tepat di tengah horizontal ruangan
        const spawnY = offsetY + (1024 * scaleFactor) - 200; // Berada dekat garis batas bawah ruangan
        
        // Spawn karakter dengan gambar menghadap belakang (seolah baru masuk jalan ke atas)
        this.player = this.physics.add.sprite(spawnX, spawnY, 'player-belakang');
        this.player.setScale(0.12 * scaleFactor); 

        // ==========================================
        // MENGUBAH HITBOX CHARACTER HANYA DI KAKI
        // ==========================================
        
        // Mengambil ukuran asli gambar sprite (sebelum kena efek setScale)
        const spriteWidth = this.player.width;
        const spriteHeight = this.player.height;

        // Menentukan ukuran kotak hitbox (hanya sebagian kecil dari gambar asli)
        const hitboxWidth = spriteWidth * 0.05;   // 40% dari lebar asli karakter
        const hitboxHeight = spriteHeight * 0.05; // 15% dari tinggi asli karakter (hanya telapak kaki)

        // Menghitung posisi geser (offset) agar kotak itu pas berada di ujung bawah
        const hitOffsetX = (spriteWidth - hitboxWidth) / 2; // Diposisikan di tengah secara horizontal
        const hitOffsetY = spriteHeight - hitboxHeight - 10; // Digeser ke paling bawah gambar (minus margin sedikit)

        // Menerapkan Hitbox ke fisika player
        this.player.body.setSize(hitboxWidth, hitboxHeight);
        this.player.body.setOffset(hitOffsetX, hitOffsetY);

        // Agar tidak keluar kanvas
        this.player.body.setCollideWorldBounds(true); 

        // 6. AKTIFKAN TABRAKAN PLAYER DENGAN TEMBOK
        this.physics.add.collider(this.player, this.obstacles);

        // Kontrol
        this.cursors = this.input.keyboard.createCursorKeys();

        // Teks Petunjuk
        this.add.text(30, 30, 'Gunakan Tombol Panah untuk Bergerak', { 
            font: '16px Arial', 
            fill: '#ffffff' 
        });
    }

    update() {
        const speed = 250;
        this.player.body.setVelocity(0);

        if (this.cursors.left.isDown) {
            this.player.body.setVelocityX(-speed);
            this.player.setTexture('player-kiri');
        } else if (this.cursors.right.isDown) {
            this.player.body.setVelocityX(speed);
            this.player.setTexture('player-kanan');
        } else if (this.cursors.up.isDown) {
            this.player.body.setVelocityY(-speed);
            this.player.setTexture('player-belakang');
        } else if (this.cursors.down.isDown) {
            this.player.body.setVelocityY(speed);
            this.player.setTexture('player-depan');
        }
    }
}

// Konfigurasi Layar
const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: true // BIARKAN TRUE DULU AGAR ANDA BISA MELIHAT KOTAK KAKINYA
        }
    },
    scene: [GameScene]
};

const game = new Phaser.Game(config);