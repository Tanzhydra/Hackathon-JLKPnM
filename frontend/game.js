class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    preload() {
        // Pastikan path dan nama file sudah benar sesuai struktur folder Anda
        this.load.image('player-depan', 'assets/avatar depan.png');
        this.load.image('player-belakang', 'assets/ava belakang.png');
        this.load.image('player-kiri', 'assets/ava kiri.png');
        this.load.image('player-kanan', 'assets/ava kanan.png');
        this.load.image('player-kanan', 'assets/Lobby_Background.png');
    }

    create() {
        // Teks petunjuk
        this.add.text(20, 20, 'Gunakan Tombol Panah untuk Menggerakkan Karakter', { 
            font: '16px Arial', 
            fill: '#ffffff' 
        });

        // 1. Buat Sprite fisika
        this.player = this.physics.add.sprite(400, 300, 'player-depan');

        // 2. Atur Skala Gambar
        // Karena gambar aslinya besar (misal 500px), kita perkecil menjadi seperempatnya (0.25)
        // Sesuaikan angka ini (0.1 sampai 1.0) sampai ukurannya pas di game Anda.
        this.player.setScale(0.1); 

        // 3. Sesuaikan Kotak Tabrakan Fisika (Body)
        // Setelah disekala, gambar terlihat kecil tetapi kotak fisika (body)
        // seringkali masih sebesar gambar asli.
        // Kita harus mengatur ulang ukuran body agar sesuai dengan gambar yang sudah disekala.
        // Parameter: setSize(lebar_visual_dalam_piksel, tinggi_visual_dalam_piksel)
        // Anda harus memperkirakan ukuran gambar karakter Anda setelah disekala (misal menjadi 64x64)
        this.player.body.setSize(128, 128); 
        this.player.body.setOffset(100, 80); // Geser kotak body agar pas di tengah karakter, jika perlu.

        // Agar tidak keluar dari batas layar game
        this.player.body.setCollideWorldBounds(true);

        this.cursors = this.input.keyboard.createCursorKeys();
    }

    update(time, delta) {
        const speed = 200;
        this.player.body.setVelocity(0);

        if (this.cursors.left.isDown) {
            this.player.body.setVelocityX(-speed);
            this.player.setTexture('player-kiri');
        } else if (this.cursors.right.isDown) {
            this.player.body.setVelocityX(speed);
            this.player.setTexture('player-kanan');
        }

        if (this.cursors.up.isDown) {
            this.player.body.setVelocityY(-speed);
            this.player.setTexture('player-belakang');
        } else if (this.cursors.down.isDown) {
            this.player.body.setVelocityY(speed);
            this.player.setTexture('player-depan');
        }
    }
}

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: true // SET KE TRUE UNTUK MELIHAT KENAPA GAMBAR BLINK-BLINK
        }
    },
    scene: [GameScene]
};

const game = new Phaser.Game(config);