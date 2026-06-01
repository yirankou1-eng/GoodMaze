// --- 1. 全局配置与状态 ---
const CONFIG = {
    viewHeight: 18,       
    wallHeight: 54,       
    playerSpeed: 0.5,     
    mapWidth: 300,        
    lookSensitivity: 0.005 // 视角转动灵敏度
};

let scene, camera, renderer;
// 视角角度状态
let yaw = 0;
let pitch = 0;
// 移动输入状态 (-1 到 1)
let input = { forward: 0, right: 0 };
let keys = { w: false, a: false, s: false, d: false };

let collisionGrid = [];   
let goalZone = { x: 0, z: 0, radius: 2 }; 

const screens = {
    menu: document.getElementById('menu-screen'),
    game: document.getElementById('game-ui'),
    victory: document.getElementById('victory-screen')
};

// --- 2. 颜色数学转换模块 ---
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) h = 0;
    else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function hsvToRgbColor(h, s, v) {
    h = h / 360; s = s / 100; v = v / 100;
    let r, g, b;
    let i = Math.floor(h * 6);
    let f = h * 6 - i;
    let p = v * (1 - s);
    let q = v * (1 - f * s);
    let t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return new THREE.Color(r, g, b);
}

// --- 3. 游戏状态流转 ---
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

document.getElementById('btn-return-menu').onclick = () => {
    showScreen('menu');
    if (scene) {
        while(scene.children.length > 0){ scene.remove(scene.children[0]); }
    }
};

const levels = ['pass1.png', 'pass2.png'];
const levelList = document.getElementById('level-list');
levels.forEach(level => {
    let btn = document.createElement('button');
    btn.className = 'level-btn';
    btn.innerText = level;
    btn.onclick = () => loadLevel(`maps/${level}`);
    levelList.appendChild(btn);
});

// --- 4. 3D 渲染与地图生成 ---
function initThreeJS() {
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false }); 
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // 修改：浅蓝天空背景

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // 重置视角
    yaw = 0; pitch = 0;
    camera.rotation.set(0, 0, 0);
    
    // 修改：提升环境光强度
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(CONFIG.mapWidth/2, 300, CONFIG.mapWidth/2);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -CONFIG.mapWidth;
    dirLight.shadow.camera.right = CONFIG.mapWidth;
    dirLight.shadow.camera.top = CONFIG.mapWidth;
    dirLight.shadow.camera.bottom = -CONFIG.mapWidth;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);
}

function loadLevel(imageSrc) {
    showScreen('game');
    initThreeJS();
    
    const img = new Image();
    img.src = imageSrc;
    img.crossOrigin = "Anonymous"; 
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, img.width, img.height).data;

        parseMapAndGenerate(imgData, img.width, img.height);
        requestAnimationFrame(gameLoop);
    };
    img.onerror = () => {
        alert("无法加载地图图片，请检查本地服务器或文件路径。");
        showScreen('menu');
    };
}

function parseMapAndGenerate(pixels, width, height) {
    collisionGrid = Array(width).fill().map(() => Array(height).fill(false));
    let wallCount = 0;
    let spawns = [];
    let goals = [];

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3] === 0) continue; 
        let hsv = rgbToHsv(pixels[i], pixels[i+1], pixels[i+2]);
        let pixelIndex = i / 4;

        if (hsv.v < 20) wallCount++;
        else if ((hsv.h < 15 || hsv.h > 345) && hsv.s > 50 && hsv.v > 50) spawns.push(pixelIndex);
        else if (hsv.h > 100 && hsv.h < 150 && hsv.s > 50 && hsv.v > 50) goals.push(pixelIndex);
    }

    const geometry = new THREE.BoxGeometry(1, CONFIG.wallHeight, 1);
    const randomHue = Math.floor(Math.random() * 360);
    const wallColor = hsvToRgbColor(randomHue, 60, 100);
    const material = new THREE.MeshLambertMaterial({ color: wallColor });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, wallCount);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;
    
    const dummy = new THREE.Object3D();
    let wallIndex = 0;

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3] === 0) continue;
        let hsv = rgbToHsv(pixels[i], pixels[i+1], pixels[i+2]);
        let pixelIndex = i / 4;
        let x = pixelIndex % width;
        let z = Math.floor(pixelIndex / width);

        if (hsv.v < 20) {
            dummy.position.set(x, CONFIG.wallHeight / 2, z); 
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(wallIndex++, dummy.matrix);
            collisionGrid[x][z] = true;
        }
    }
    scene.add(instancedMesh);

    // 修改：生成纯白地面
    const floorGeo = new THREE.PlaneGeometry(width, height);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); 
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width/2 - 0.5, 0, height/2 - 0.5); 
    floor.receiveShadow = true;
    scene.add(floor);

    if (spawns.length > 0) {
        let spawnPixel = spawns[Math.floor(Math.random() * spawns.length)];
        camera.position.set(spawnPixel % width, CONFIG.viewHeight, Math.floor(spawnPixel / width));
    } else {
        camera.position.set(1, CONFIG.viewHeight, 1);
    }

    if (goals.length > 0) {
        let goalPixel = goals[Math.floor(Math.random() * goals.length)];
        goalZone.x = goalPixel % width;
        goalZone.z = Math.floor(goalPixel / width);
        goalZone.radius = 2; 
    }
}

// --- 5. 多端输入控制引擎 ---

// 键盘控制逻辑
document.addEventListener('keydown', (e) => {
    let key = e.key.toLowerCase();
    if(keys.hasOwnProperty(key)) keys[key] = true;
});
document.addEventListener('keyup', (e) => {
    let key = e.key.toLowerCase();
    if(keys.hasOwnProperty(key)) keys[key] = false;
});

// 摇杆控制逻辑 (仅控制移动量)
const joystickZone = document.getElementById('joystick-zone');
const knob = document.getElementById('joystick-knob');
let isJoyDragging = false;

joystickZone.addEventListener('touchstart', handleJoystickStart, {passive: false});
joystickZone.addEventListener('touchmove', handleJoystickMove, {passive: false});
joystickZone.addEventListener('touchend', handleJoystickEnd);
joystickZone.addEventListener('mousedown', handleJoystickStart);

function handleJoystickStart(e) { 
    if(e.target === joystickZone || e.target === knob) {
        isJoyDragging = true; 
        handleJoystickMove(e); 
    }
}
function handleJoystickEnd() {
    isJoyDragging = false;
    knob.style.transform = `translate(0px, 0px)`;
    input.forward = 0;
    input.right = 0;
}
function handleJoystickMove(e) {
    if (!isJoyDragging) return;
    e.preventDefault();
    const rect = joystickZone.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.min(Math.sqrt(dx*dx + dy*dy), 35); 
    const angle = Math.atan2(dy, dx);
    
    knob.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
    
    // 将摇杆位移归一化并映射到 input (-1 到 1)
    input.right = Math.cos(angle) * (distance / 35);
    input.forward = Math.sin(angle) * (distance / 35); 
}

// 视角控制逻辑 (鼠标拖动/屏幕划动)
let isLooking = false;
let lastLookX = 0;
let lastLookY = 0;

const gameScreen = document.getElementById('game-canvas');

// PC 鼠标划动转头
gameScreen.addEventListener('mousedown', (e) => {
    isLooking = true;
    lastLookX = e.clientX;
    lastLookY = e.clientY;
});
document.addEventListener('mousemove', (e) => {
    if(!isJoyDragging) { 
        handleJoystickMove(e); 
    }
    if (!isLooking) return;
    let dx = e.clientX - lastLookX;
    let dy = e.clientY - lastLookY;
    lastLookX = e.clientX;
    lastLookY = e.clientY;
    updateCameraRotation(dx, dy);
});
document.addEventListener('mouseup', (e) => {
    isLooking = false;
    if(isJoyDragging) handleJoystickEnd();
});

// 手机触摸屏幕划动转头
gameScreen.addEventListener('touchstart', (e) => {
    // 寻找不在摇杆区域内的触摸点作为视角控制点
    for(let i = 0; i < e.touches.length; i++) {
        let t = e.touches[i];
        if(t.target === gameScreen) {
            isLooking = true;
            lastLookX = t.clientX;
            lastLookY = t.clientY;
            break;
        }
    }
}, {passive: false});

gameScreen.addEventListener('touchmove', (e) => {
    if(!isLooking) return;
    for(let i = 0; i < e.touches.length; i++) {
        let t = e.touches[i];
        if(t.target === gameScreen) {
            let dx = t.clientX - lastLookX;
            let dy = t.clientY - lastLookY;
            lastLookX = t.clientX;
            lastLookY = t.clientY;
            updateCameraRotation(dx, dy);
            break;
        }
    }
}, {passive: false});

gameScreen.addEventListener('touchend', () => { isLooking = false; });

function updateCameraRotation(dx, dy) {
    yaw -= dx * CONFIG.lookSensitivity;
    pitch -= dy * CONFIG.lookSensitivity;
    // 限制抬头低头的角度，防止视角翻转 (正负90度)
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

// --- 6. 游戏主循环与物理 ---
function gameLoop() {
    if (screens.game.classList.contains('active')) {
        
        // 综合键盘和摇杆的输入值
        let moveZ = input.forward;
        let moveX = input.right;
        
        if (keys.w) moveZ -= 1;
        if (keys.s) moveZ += 1;
        if (keys.a) moveX -= 1;
        if (keys.d) moveX += 1;

        // 限制最大输入向量长度为 1
        let length = Math.sqrt(moveX*moveX + moveZ*moveZ);
        if(length > 1) { moveX /= length; moveZ /= length; }

        // 获取摄像机当前的前向与右向向量 (忽略 Y 轴高度变化)
        let forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0; 
        forward.normalize();
        
        let right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        right.y = 0; 
        right.normalize();

        // 根据朝向计算最终的速度向量
        let velocity = new THREE.Vector3()
            .addScaledVector(forward, -moveZ * CONFIG.playerSpeed)
            .addScaledVector(right, moveX * CONFIG.playerSpeed);

        let nextX = camera.position.x + velocity.x;
        let nextZ = camera.position.z + velocity.z;

        let gridX = Math.round(nextX);
        let gridZ = Math.round(nextZ);
        
        // 碰撞检测与滑动
        if (gridX >= 0 && gridX < collisionGrid.length && gridZ >= 0 && gridZ < collisionGrid[0].length) {
            if (!collisionGrid[gridX][Math.round(camera.position.z)]) {
                camera.position.x = nextX;
            }
            if (!collisionGrid[Math.round(camera.position.x)][gridZ]) {
                camera.position.z = nextZ;
            }
        }

        let distToGoal = Math.sqrt(Math.pow(camera.position.x - goalZone.x, 2) + Math.pow(camera.position.z - goalZone.z, 2));
        if (distToGoal < goalZone.radius) {
            showScreen('victory');
            return; 
        }

        renderer.render(scene, camera);
        requestAnimationFrame(gameLoop);
    }
}
