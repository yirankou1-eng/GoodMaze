// --- 1. 全局配置与状态 ---
const CONFIG = {
    viewHeight: 18,       
    wallHeight: 54,       
    playerSpeed: 0.5,     
    mapWidth: 300,        
    lookSensitivity: 0.005 
};

let scene, camera, renderer;
let yaw = 0, pitch = 0;
let input = { forward: 0, right: 0 };
let keys = { w: false, a: false, s: false, d: false };

let collisionGrid = [];   
let goalGrid = []; 
let animationFrameId; 

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

// 动态生成像素网格边缘纹理 (黑色细竖线)
function createWallEdgeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // 底色填充白色（用于和 Three.js 材质颜色进行乘法混合）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    
    // 在左右边缘绘制细黑色竖线
    ctx.fillStyle = '#111111'; 
    const lineWidth = 2; // 竖线粗细
    ctx.fillRect(0, 0, lineWidth, 64); // 左边缘
    ctx.fillRect(64 - lineWidth, 0, lineWidth, 64); // 右边缘
    
    const texture = new THREE.CanvasTexture(canvas);
    // 使用最邻近过滤，确保线条保持锐利的像素边缘，不产生模糊过渡
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

// --- 3. 游戏状态流转与自动目录检索 ---
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

document.getElementById('btn-return-menu').onclick = () => {
    showScreen('menu');
    cancelAnimationFrame(animationFrameId); 
    if (scene) {
        while(scene.children.length > 0){ 
            let child = scene.children[0];
            if(child.geometry) child.geometry.dispose();
            if(child.material) child.material.dispose();
            scene.remove(child); 
        }
    }
    keys = { w: false, a: false, s: false, d: false };
    input = { forward: 0, right: 0 };
};

// 自动按顺序探测 maps 文件夹内的关卡图片
const levelList = document.getElementById('level-list');
let currentMapIndex = 1;

function scanMapFolder() {
    let mapName = `pass${currentMapIndex}.png`;
    let mapPath = `maps/${mapName}`;
    let tempImg = new Image();
    
    tempImg.onload = () => {
        let btn = document.createElement('button');
        btn.className = 'level-btn';
        btn.innerText = `关卡 ${currentMapIndex} (${mapName})`;
        btn.onclick = () => loadLevel(mapPath);
        levelList.appendChild(btn);
        
        currentMapIndex++;
        scanMapFolder(); 
    };
    
    tempImg.onerror = () => {
        if (currentMapIndex === 1) {
            let errorMsg = document.createElement('p');
            errorMsg.innerText = "未找到 pass1.png，请检查图片命名或本地服务器状态。";
            levelList.appendChild(errorMsg);
        }
    };
    tempImg.src = mapPath;
}
scanMapFolder();

// --- 4. 3D 渲染与地图生成 ---
function initThreeJS() {
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false }); 
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    yaw = 0; pitch = 0;
    camera.rotation.set(0, 0, 0);
    
    // 提高环境光强度，避免阴影死黑
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); 
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
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
        
        cancelAnimationFrame(animationFrameId);
        gameLoop();
    };
}

function parseMapAndGenerate(pixels, width, height) {
    collisionGrid = Array(width).fill().map(() => Array(height).fill(false));
    goalGrid = Array(width).fill().map(() => Array(height).fill(false)); 
    let wallCount = 0;
    let spawns = [];

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3] === 0) continue; 
        let hsv = rgbToHsv(pixels[i], pixels[i+1], pixels[i+2]);
        let pixelIndex = i / 4;

        if (hsv.v < 20) wallCount++;
        else if ((hsv.h < 15 || hsv.h > 345) && hsv.s > 50 && hsv.v > 50) spawns.push(pixelIndex);
    }

    const geometry = new THREE.BoxGeometry(1, CONFIG.wallHeight, 1);
    
    // 统一颜色规范：H=20, S=40, V=90
    const fixedWallColor = hsvToRgbColor(20, 40, 90);
    // 使用 StandardMaterial 获取更好的光影体积感，并绑定程序化边缘纹理
    const material = new THREE.MeshStandardMaterial({ 
        color: fixedWallColor, 
        map: createWallEdgeTexture(),
        roughness: 0.9, // 高糙度，减少反光
        metalness: 0.0
    });
    
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
        } else if (hsv.h > 100 && hsv.h < 150 && hsv.s > 50 && hsv.v > 50) {
            goalGrid[x][z] = true;
        }
    }
    scene.add(instancedMesh);

    const floorGeo = new THREE.PlaneGeometry(width, height);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 }); 
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
}

// --- 5. 多端输入控制引擎 (支持双指独立触控) ---
document.addEventListener('keydown', (e) => {
    let key = e.key.toLowerCase();
    if(keys.hasOwnProperty(key)) keys[key] = true;
});
document.addEventListener('keyup', (e) => {
    let key = e.key.toLowerCase();
    if(keys.hasOwnProperty(key)) keys[key] = false;
});

const joystickZone = document.getElementById('joystick-zone');
const knob = document.getElementById('joystick-knob');
let isJoyDragging = false;
let joystickTouchId = null; 

joystickZone.addEventListener('touchstart', handleJoystickStart, {passive: false});
document.addEventListener('touchmove', handleJoystickMove, {passive: false});
document.addEventListener('touchend', handleJoystickEnd);
document.addEventListener('touchcancel', handleJoystickEnd);

joystickZone.addEventListener('mousedown', handleJoystickStart);
document.addEventListener('mousemove', handleJoystickMove);
document.addEventListener('mouseup', handleJoystickEnd);

function handleJoystickStart(e) {
    if (e.type === 'mousedown') {
        isJoyDragging = true;
        updateJoystickPosition(e.clientX, e.clientY);
    } else if (e.type === 'touchstart') {
        for (let i = 0; i < e.changedTouches.length; i++) {
            let t = e.changedTouches[i];
            if (joystickTouchId === null && (t.target === joystickZone || t.target === knob)) {
                joystickTouchId = t.identifier;
                isJoyDragging = true;
                updateJoystickPosition(t.clientX, t.clientY);
            }
        }
    }
}

function handleJoystickMove(e) {
    if (!isJoyDragging) return;
    if (e.type === 'mousemove') {
        updateJoystickPosition(e.clientX, e.clientY);
    } else if (e.type === 'touchmove') {
        for (let i = 0; i < e.changedTouches.length; i++) {
            let t = e.changedTouches[i];
            if (t.identifier === joystickTouchId) {
                updateJoystickPosition(t.clientX, t.clientY);
            }
        }
    }
}

function handleJoystickEnd(e) {
    if (e.type === 'mouseup') {
        resetJoystick();
    } else if (e.type === 'touchend' || e.type === 'touchcancel') {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) resetJoystick();
        }
    }
}

function resetJoystick() {
    isJoyDragging = false;
    joystickTouchId = null;
    knob.style.transform = `translate(0px, 0px)`;
    input.forward = 0;
    input.right = 0;
}

function updateJoystickPosition(clientX, clientY) {
    const rect = joystickZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.min(Math.sqrt(dx*dx + dy*dy), 35); 
    const angle = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
    input.right = Math.cos(angle) * (distance / 35);
    input.forward = Math.sin(angle) * (distance / 35); 
}

let isLooking = false;
let lookTouchId = null; 
let lastLookX = 0;
let lastLookY = 0;
const gameScreen = document.getElementById('game-canvas');

gameScreen.addEventListener('mousedown', (e) => {
    isLooking = true;
    lastLookX = e.clientX;
    lastLookY = e.clientY;
});
document.addEventListener('mousemove', (e) => {
    if (!isLooking) return;
    let dx = e.clientX - lastLookX;
    let dy = e.clientY - lastLookY;
    lastLookX = e.clientX;
    lastLookY = e.clientY;
    updateCameraRotation(dx, dy);
});
document.addEventListener('mouseup', () => { isLooking = false; });

gameScreen.addEventListener('touchstart', (e) => {
    for(let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        if(lookTouchId === null && t.target === gameScreen) {
            lookTouchId = t.identifier;
            isLooking = true;
            lastLookX = t.clientX;
            lastLookY = t.clientY;
        }
    }
}, {passive: false});

document.addEventListener('touchmove', (e) => {
    if(!isLooking) return;
    for(let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        if(t.identifier === lookTouchId) {
            let dx = t.clientX - lastLookX;
            let dy = t.clientY - lastLookY;
            lastLookX = t.clientX;
            lastLookY = t.clientY;
            updateCameraRotation(dx, dy);
        }
    }
}, {passive: false});

document.addEventListener('touchend', (e) => {
    for(let i = 0; i < e.changedTouches.length; i++) {
        if(e.changedTouches[i].identifier === lookTouchId) {
            isLooking = false;
            lookTouchId = null;
        }
    }
});
document.addEventListener('touchcancel', (e) => {
    for(let i = 0; i < e.changedTouches.length; i++) {
        if(e.changedTouches[i].identifier === lookTouchId) {
            isLooking = false;
            lookTouchId = null;
        }
    }
});

function updateCameraRotation(dx, dy) {
    yaw -= dx * CONFIG.lookSensitivity;
    pitch -= dy * CONFIG.lookSensitivity;
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

// --- 6. 游戏主循环与物理 ---
function gameLoop() {
    if (!screens.game.classList.contains('active')) return;

    let moveZ = input.forward;
    let moveX = input.right;
    
    if (keys.w) moveZ -= 1;
    if (keys.s) moveZ += 1;
    if (keys.a) moveX -= 1;
    if (keys.d) moveX += 1;

    let length = Math.sqrt(moveX*moveX + moveZ*moveZ);
    if(length > 1) { moveX /= length; moveZ /= length; }

    let forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; forward.normalize();
    
    let right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();

    let velocity = new THREE.Vector3()
        .addScaledVector(forward, -moveZ * CONFIG.playerSpeed)
        .addScaledVector(right, moveX * CONFIG.playerSpeed);

    let nextX = camera.position.x + velocity.x;
    let nextZ = camera.position.z + velocity.z;

    let gridX = Math.round(nextX);
    let gridZ = Math.round(nextZ);
    
    if (gridX >= 0 && gridX < collisionGrid.length && gridZ >= 0 && gridZ < collisionGrid[0].length) {
        if (!collisionGrid[gridX][Math.round(camera.position.z)]) camera.position.x = nextX;
        if (!collisionGrid[Math.round(camera.position.x)][gridZ]) camera.position.z = nextZ;
    }

    let currentX = Math.round(camera.position.x);
    let currentZ = Math.round(camera.position.z);
    
    if (currentX >= 0 && currentX < goalGrid.length && currentZ >= 0 && currentZ < goalGrid[0].length) {
        if (goalGrid[currentX][currentZ]) {
            showScreen('victory');
            return; 
        }
    }

    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(gameLoop);
}
