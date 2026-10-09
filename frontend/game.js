// Variabel Sesi Global
let currentUser = { role: 'mahasiswa', loggedIn: false };
let isUiActive = true; 
let supabaseClient;
let bootstrapData;
let activeScan;
let pendingProfileEmail;

const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const shortDate = value => value ? new Date(value).toLocaleDateString('id-ID') : '—';

async function client() {
    if (supabaseClient) return supabaseClient;
    const serverHint = 'Buka aplikasi melalui server backend, misalnya http://localhost:3000/, bukan dari berkas index.html atau Live Server.';
    if (window.location.protocol === 'file:') throw new Error(serverHint);
    let response;
    try {
        response = await fetch('/api/client-config', { cache: 'no-store' });
    } catch {
        throw new Error(`Konfigurasi aplikasi gagal dimuat. ${serverHint}`);
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`Konfigurasi aplikasi gagal dimuat. ${serverHint}`);
    }
    let config;
    try { config = await response.json(); }
    catch { throw new Error('Respons konfigurasi aplikasi tidak valid. Periksa server backend.'); }
    if (!config.supabaseUrl || !config.supabaseKey || !window.supabase) throw new Error('Supabase belum dikonfigurasi');
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
    return supabaseClient;
}

async function api(path, options = {}) {
    const auth = await client();
    const { accessToken, ...requestOptions } = options;
    // Gunakan token hasil login langsung untuk permintaan pertama setelah autentikasi.
    let token = accessToken;
    if (!token) {
        const { data: { session }, error } = await auth.auth.getSession();
        if (error || !session?.access_token) throw new Error('Sesi berakhir. Silakan masuk kembali.');
        token = session.access_token;
    }
    const response = await fetch(path, {
        ...requestOptions,
        headers: { Authorization: `Bearer ${token}`, ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}), ...requestOptions.headers },
        cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const details = Array.isArray(result.issues) ? `: ${result.issues.join('; ')}` : '';
        const failure = new Error(`${result.error || result.status || 'Permintaan gagal'}${details}`);
        failure.result = result;
        failure.status = response.status;
        throw failure;
    }
    return result;
}

function setMessage(id, message, failed = false) {
    const element = $(id);
    element.textContent = message;
    element.classList.toggle('text-red-600', failed);
}

async function refreshBootstrap(accessToken) {
    bootstrapData = await api('/api/bootstrap', accessToken ? { accessToken } : {});
    const role = bootstrapData.profile.role;
    if (role !== 'student' && role !== 'officer') throw new Error('Peran akun tidak dikenal');
    currentUser = { role: role === 'student' ? 'mahasiswa' : 'pegawai', loggedIn: true, profile: bootstrapData.profile };
    renderStudentRequests();
    return bootstrapData;
}

function renderStudentRequests() {
    if (currentUser.role !== 'mahasiswa' || !bootstrapData) return;
    const requests = bootstrapData.requests || [];
    $('student-requests').innerHTML = requests.length
        ? requests.map(item => `<div>${safe(item.id.slice(0, 8))} · ${safe(item.status)} · ${shortDate(item.updated_at)}</div>`).join('')
        : 'Belum ada pengajuan.';
}

async function ensureProfile(user, accessToken) {
    try { return await refreshBootstrap(accessToken); }
    catch (error) {
        if (error.status !== 404) throw error;
        const meta = user?.user_metadata || {};
        if (!meta.full_name || !meta.nrp || !meta.class_name || !meta.program_code) {
            error.profileIncomplete = true;
            throw error;
        }
        try {
            await api('/api/profile', { method: 'POST', body: JSON.stringify({ full_name: meta.full_name, nrp: meta.nrp, class_name: meta.class_name, program_code: meta.program_code }), ...(accessToken ? { accessToken } : {}) });
        } catch (profileError) {
            if (profileError.result?.details) profileError.profileIncomplete = true;
            throw profileError;
        }
        return refreshBootstrap(accessToken);
    }
}

function validateProfile(profile) {
    const fields = [
        ['Nama lengkap', profile.full_name, 120],
        ['NRP', profile.nrp, 40],
        ['Kelas', profile.class_name, 80],
        ['Kode program studi', profile.program_code, 40],
    ];
    for (const [label, value, maximum] of fields) {
        if (value.length < 2 || value.length > maximum) {
            throw new Error(`${label} harus 2–${maximum} karakter.`);
        }
    }
}

async function uploadFile(file, purpose) {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) throw new Error('Berkas harus PDF, JPG, atau PNG');
    const ticket = await api('/api/uploads/ticket', { method: 'POST', body: JSON.stringify({ mime_type: file.type, purpose }) });
    if (file.size > ticket.max_bytes) throw new Error('Berkas melebihi batas 10 MB');
    const auth = await client();
    const { error } = await auth.storage.from('form14-private').uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    if (error) throw new Error(`Unggah ${purpose === 'doctor_letter' ? 'surat dokter' : 'Form 14'} gagal: ${error.message}`);
    return ticket.path;
}

async function pollScan(scanId) {
    for (let count = 0; count < 80; count++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const { scan } = await api(`/api/scans/${encodeURIComponent(scanId)}`);
        renderScanResult(scan);
        const message = scan.status === 'processing' || scan.status === 'uploaded'
            ? `AI sedang membaca scan... ${Math.floor((count + 1) * 3 / 60)} menit ${((count + 1) * 3) % 60} detik.`
            : `Status scan: ${scan.status}${scan.issues?.length ? ` — ${scan.issues.join('; ')}` : ''}`;
        setMessage('student-status', message, scan.status === 'ai_failed' || scan.status === 'needs_reupload');
        if (!['uploaded', 'processing'].includes(scan.status)) return scan;
    }
    return null;
}

function renderScanResult(scan) {
    const extraction = scan?.extraction;
    $('scan-result').innerHTML = extraction ? `<strong>Hasil baca:</strong> ${safe(extraction.name?.text)} · ${safe(extraction.nrp?.text)} · ${safe(extraction.lines?.length || 0)} baris<br>${(extraction.lines || []).map((row, index) => `${index + 1}. ${safe(row.course_name?.text)} — ${safe(row.reason?.text)}`).join('<br>')}` : '';
}

async function loadDashboard() {
    if (currentUser.role !== 'pegawai') return;
    try {
        setMessage('worker-status', 'Memuat pengajuan...');
        const data = await refreshBootstrap();
        const requests = data.requests || [];
        $('count-total').textContent = requests.length;
        $('count-ready').textContent = requests.filter(r => r.status === 'submitted' || r.status === 'approved_pending').length;
        $('count-waiting').textContent = requests.filter(r => r.status === 'needs_fix' || r.status === 'conflict').length;
        $('count-rejected').textContent = requests.filter(r => r.status === 'rejected').length;
        $('worker-requests').innerHTML = requests.length ? requests.map(r => {
            const student = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
            return `<div class="grid grid-cols-6 items-center px-2 py-2 border-b gap-2"><span title="${safe(r.id)}">${safe(r.id.slice(0, 8))}</span><span>${safe(student?.full_name || '—')}</span><span>Form 14</span><span>${shortDate(r.created_at)}</span><span>${safe(r.status)}</span><button class="view-request text-blue-700 underline" data-id="${safe(r.id)}">Lihat</button></div>`;
        }).join('') : 'Belum ada pengajuan.';
        setMessage('worker-status', '');
    } catch (error) { setMessage('worker-status', error.message, true); }
}

async function openRequest(id) {
    const panel = $('worker-detail');
    panel.dataset.requestId = id;
    panel.classList.remove('hidden');
    panel.textContent = 'Memuat detail...';
    try {
        const detail = await api(`/api/form14/${encodeURIComponent(id)}`);
        const version = detail.versions.find(v => v.id === detail.form.current_version_id);
        if (!version) throw new Error('Versi pengajuan belum tersedia');
        panel.innerHTML = `<div class="flex justify-between mb-3"><h3 class="font-bold">Form 14 · ${safe(id.slice(0, 8))}</h3><button id="close-detail" class="text-blue-700">Tutup</button></div>
            <p>${safe(version.name_snapshot)} · ${safe(version.nrp_snapshot)} · ${safe(detail.form.status)}</p>
            <div class="my-3"><button class="open-file text-blue-700 underline" data-path="${safe(version.form_path)}">Lihat Form 14</button></div>
            <div id="detail-lines">${version.lines.map(line => `<div class="border rounded-lg p-3 mb-2" data-line="${safe(line.id)}">
                <p class="font-semibold">${safe(line.course_name)} · ${safe(line.class_date)} · ${safe(line.state)}</p>
                <p>Alasan: ${safe(line.reason)} · Dosen: ${safe(line.lecturer_name)}</p>
                ${line.doctor_path ? `<button class="open-file text-blue-700 underline" data-path="${safe(line.doctor_path)}">Lihat surat dokter</button>` : ''}
                ${line.state === 'submitted' ? `<div class="mt-2"><select class="decision border p-1"><option value="approve">Setujui</option><option value="reject">Tolak</option><option value="needs_fix">Minta perbaikan</option></select>
                <input class="reason border p-1" placeholder="Alasan keputusan" maxlength="1000">
                <label class="block"><input class="student-check" type="checkbox"> Tanda tangan mahasiswa diperiksa</label>
                <label class="block"><input class="lecturer-check" type="checkbox"> Tanda tangan dosen diperiksa</label>
                ${line.doctor_path ? '<label class="block"><input class="doctor-check" type="checkbox"> Surat dokter diperiksa</label>' : ''}
                <button class="decide bg-blue-600 text-white px-3 py-1 rounded mt-2">Simpan keputusan</button></div>` : ''}
                ${line.state === 'approved_pending' ? '<button class="apply bg-emerald-600 text-white px-3 py-1 rounded mt-2">Terapkan keputusan</button>' : ''}
            </div>`).join('')}</div><p id="detail-status" role="status"></p>`;
    } catch (error) { panel.textContent = error.message; }
}

async function detailAction(event) {
    const target = event.target;
    if (target.id === 'close-detail') { $('worker-detail').classList.add('hidden'); return; }
    const file = target.closest('.open-file');
    if (file) {
        try {
            const result = await api(`/api/files?path=${encodeURIComponent(file.dataset.path)}`);
            window.open(result.url, '_blank', 'noopener,noreferrer');
        } catch (error) { setMessage('detail-status', error.message, true); }
        return;
    }
    const row = target.closest('[data-line]');
    if (!row || (!target.classList.contains('decide') && !target.classList.contains('apply'))) return;
    target.disabled = true;
    try {
        setMessage('worker-status', '');
        setMessage('detail-status', '');
        const path = `/api/form14/lines/${encodeURIComponent(row.dataset.line)}/${target.classList.contains('decide') ? 'decision' : 'apply'}`;
        const body = target.classList.contains('decide') ? JSON.stringify({
            decision: row.querySelector('.decision').value,
            reason: row.querySelector('.reason').value,
            student_signature_checked: row.querySelector('.student-check').checked,
            lecturer_signature_checked: row.querySelector('.lecturer-check').checked,
            doctor_letter_checked: !!row.querySelector('.doctor-check')?.checked,
        }) : undefined;
        await api(path, { method: 'POST', ...(body ? { body } : {}) });
        setMessage('worker-status', 'Keputusan berhasil disimpan.');
        await loadDashboard();
        await openRequest($('worker-detail').dataset.requestId);
    } catch (error) { setMessage('detail-status', error.message, true); }
    finally { target.disabled = false; }
}

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

        this.cursors = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.UP,
            down: Phaser.Input.Keyboard.KeyCodes.DOWN,
            left: Phaser.Input.Keyboard.KeyCodes.LEFT,
            right: Phaser.Input.Keyboard.KeyCodes.RIGHT
        }, false);
        this.wasd = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D
        }, false);
        
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
        this.load.tilemapTiledJSON('room1-map', 'assets/room1.tmj');
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

        this.cursors = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.UP,
            down: Phaser.Input.Keyboard.KeyCodes.DOWN,
            left: Phaser.Input.Keyboard.KeyCodes.LEFT,
            right: Phaser.Input.Keyboard.KeyCodes.RIGHT
        }, false);
        this.wasd = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D
        }, false);
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
    $('btn-submit-signup').onclick = async () => {
        const button = $('btn-submit-signup');
        button.disabled = true;
        try {
            setMessage('signup-status', '');
            const email = $('su-email').value.trim();
            const password = $('su-pass').value;
            const full_name = $('su-nama').value.trim();
            const nrp = $('su-id').value.trim();
            const class_name = $('su-class').value.trim();
            const program_code = $('su-program').value.trim();
            validateProfile({ full_name, nrp, class_name, program_code });
            if (!email || !$('su-email').checkValidity()) throw new Error('Isi alamat email yang valid.');
            const auth = await client();
            if (pendingProfileEmail) {
                if (email !== pendingProfileEmail) throw new Error(`Gunakan email akun yang sedang dilengkapi: ${pendingProfileEmail}`);
                await api('/api/profile', { method: 'POST', body: JSON.stringify({ full_name, nrp, class_name, program_code }) });
                pendingProfileEmail = undefined;
                button.textContent = 'Daftar';
                $('login-email').value = email;
                switchToSignin();
                setMessage('signin-status', 'Profil tersimpan. Masuk kembali dengan password akun Anda.');
                return;
            }
            if (password.length < 6) throw new Error('Password minimal 6 karakter.');
            const { data, error } = await auth.auth.signUp({ email, password, options: { data: { full_name, nrp, class_name, program_code } } });
            if (error) throw error;
            if (data.session) {
                try {
                    await api('/api/profile', { method: 'POST', body: JSON.stringify({ full_name, nrp, class_name, program_code }), accessToken: data.session.access_token });
                } catch (profileError) {
                    $('login-email').value = email;
                    switchToSignin();
                    setMessage('signin-status', `Akun sudah dibuat, tetapi profil belum tersimpan: ${profileError.message}. Coba masuk untuk melengkapi profil.`, true);
                    return;
                }
            }
            $('login-email').value = email;
            switchToSignin();
            setMessage('signin-status', data.session
                ? 'Akun dibuat. Masukkan password untuk masuk.'
                : 'Jika pendaftaran baru berhasil, buka tautan konfirmasi yang dikirim ke email Anda, lalu masuk. Periksa folder spam juga.');
        } catch (error) { setMessage('signup-status', `${pendingProfileEmail ? 'Penyimpanan profil' : 'Pendaftaran'} gagal: ${error.message}`, true); }
        finally { button.disabled = false; }
    };

    $('btn-submit-signin').onclick = async () => {
        const button = $('btn-submit-signin');
        button.disabled = true;
        let signedInUser;
        try {
            setMessage('signin-status', 'Memeriksa akun...');
            const auth = await client();
            const { data: signInData, error } = await auth.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value });
            if (error) throw error;
            if (!signInData.session?.access_token || !signInData.user) throw new Error('Sesi login tidak tersedia. Silakan coba masuk kembali.');
            signedInUser = signInData.user;
            await ensureProfile(signedInUser, signInData.session.access_token);
            pendingProfileEmail = undefined;
            setMessage('signin-status', '');
            isUiActive = false;
            $('signin-screen').classList.add('hidden');
            const wrapper = $('main-wrapper');
            wrapper.style.backgroundImage = 'none';
            wrapper.style.backgroundColor = '#0b0f19';
            $('game-container').classList.remove('hidden');
            returnGameFocus();
        } catch (error) {
            if (error.profileIncomplete) {
                pendingProfileEmail = signedInUser?.email;
                const meta = signedInUser?.user_metadata || {};
                $('su-nama').value = meta.full_name || '';
                $('su-id').value = meta.nrp || '';
                $('su-class').value = meta.class_name || '';
                $('su-program').value = meta.program_code || '';
                $('su-email').value = pendingProfileEmail || '';
                switchToSignup();
                setMessage('signup-status', 'Akun sudah dibuat, tetapi profil belum lengkap. Perbaiki isian yang kurang lalu pilih Lengkapi Profil.', true);
                $('btn-submit-signup').textContent = 'Lengkapi Profil';
                return;
            }
            const message = error.code === 'email_not_confirmed'
                ? 'Email belum dikonfirmasi. Buka tautan di email Anda atau pilih Kirim Ulang Email Konfirmasi.'
                : error.code === 'invalid_credentials'
                    ? 'Email atau password tidak cocok. Periksa kembali keduanya. Jika baru mendaftar, konfirmasi email terlebih dahulu; jika email sudah pernah dipakai, gunakan password akun sebelumnya.'
                    : `Gagal masuk: ${error.message}`;
            setMessage('signin-status', message, true);
        }
        finally { button.disabled = false; }
    };

    $('btn-resend-confirmation').onclick = async () => {
        const button = $('btn-resend-confirmation');
        const email = $('login-email').value.trim();
        if (!email) { setMessage('signin-status', 'Isi email terlebih dahulu untuk mengirim ulang konfirmasi.', true); return; }
        button.disabled = true;
        try {
            const auth = await client();
            const { error } = await auth.auth.resend({ type: 'signup', email });
            if (error) throw error;
            setMessage('signin-status', 'Jika akun menunggu konfirmasi, email baru telah dikirim. Periksa kotak masuk dan folder spam.');
        } catch (error) { setMessage('signin-status', `Gagal mengirim ulang konfirmasi: ${error.message}`, true); }
        finally { button.disabled = false; }
    };

    $('btn-upload-submit').onclick = async () => {
        const button = $('btn-upload-submit');
        button.disabled = true;
        try {
            const form = $('file-form14').files[0];
            const doctor = $('file-doctor').files[0];
            if (!form) throw new Error('Pilih scan Form 14 terlebih dahulu.');
            const { attendance } = await refreshBootstrap();
            if (!attendance?.length) throw new Error('Akun ini belum memiliki catatan presensi berstatus A. Pastikan data presensi tersedia sebelum mengirim scan.');
            setMessage('student-status', 'Mengunggah Form 14...');
            const formPath = await uploadFile(form, 'signed_form');
            let doctorPath = null;
            if (doctor) {
                setMessage('student-status', 'Mengunggah surat dokter...');
                doctorPath = await uploadFile(doctor, 'doctor_letter');
            }
            setMessage('student-status', 'Scan sedang diproses...');
            const submission_key = crypto.randomUUID();
            const payload = JSON.stringify({ submission_key, request_id: null, form_path: formPath, doctor_path: doctorPath });
            let scan;
            try {
                scan = await api('/api/scans', { method: 'POST', body: payload });
            } catch (error) {
                if (error.result?.scan_id) {
                    activeScan = error.result.scan_id;
                    setMessage('student-status', `Status scan: ${error.result.status} — ${(error.result.issues || []).join('; ')}`, true);
                    const result = await api(`/api/scans/${encodeURIComponent(activeScan)}`);
                    renderScanResult(result.scan);
                    return;
                }
                throw error;
            }
            activeScan = scan.scan_id;
            if (scan.status === 'processing' || scan.status === 'uploaded') scan = await pollScan(scan.scan_id);
            if (scan?.status === 'ready') scan = await api('/api/scans', { method: 'POST', body: payload });
            if (activeScan) {
                const result = await api(`/api/scans/${encodeURIComponent(activeScan)}`);
                renderScanResult(result.scan);
            }
            if (scan?.status === 'submitted' || scan?.request_id) {
                await refreshBootstrap();
                setMessage('student-status', `Pengajuan terkirim. ID: ${scan.request_id || 'lihat daftar pengajuan'}`);
            } else if (scan) {
                setMessage('student-status', `Status scan: ${scan.status}${scan.issues?.length ? ` — ${scan.issues.join('; ')}` : ''}`, true);
            } else setMessage('student-status', 'Pemrosesan masih berjalan. Periksa status scan nanti.');
        } catch (error) { setMessage('student-status', error.message, true); }
        finally { button.disabled = false; }
    };
    $('worker-requests').addEventListener('click', event => {
        const button = event.target.closest('.view-request');
        if (button) openRequest(button.dataset.id);
    });
    $('worker-detail').addEventListener('click', detailAction);
    
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
