// --- 1. 全局配置与状态 ---
const CONFIG = {
    viewHeight: 18,       // 玩家视角高度
    wallHeight: 54,       // 墙壁高度 (18 * 3)
    playerSpeed: 0.5,     // 移动速度
    mapWidth: 300,        // 预期标准宽度
    wallSaturation: 0.6,  // 墙壁 S=60 (映射为 0-1)
    wallValue: 1.0        // 墙壁 V=100 (映射为 0-1)
};

let scene, camera, renderer;
let moveVector = { x: 0, z: 0 };
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
    if (max === min) {
        h = 0; // 灰色无色相
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    // 返回 H(0-360), S(0-100), V(0-100)
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

// Three.js 默认不支持直接以 HSV 初始化颜色，需转换为 RGB 或 HSL
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
    // 清理场景内存，防止反复进入导致卡顿
    if (scene) {
        while(scene.children.length > 0){ scene.remove(scene.children[0]); }
    }
};

// 模拟读取地图目录
const levels = ['pass1.png', 'pass2.png'];
const levelList = document.getElementById('level-list');
levels.forEach(level => {
    let btn = document.createElement('button');
    btn.className = 'level-btn';
    btn.innerText = level;
    // 假设地图存放在 maps 文件夹下
    btn.onclick = () => loadLevel(`maps/${level}`);
    levelList.appendChild(btn);
});

// --- 4. 3D 渲染与地图生成 ---
function initThreeJS() {
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false }); // 关闭抗锯齿提升大地图性能
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // 暗色背景

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    // 将光源放置在高处并覆盖整个地图区域
    dirLight.position.set(CONFIG.mapWidth/2, 200, CONFIG.mapWidth/2);
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
    img.crossOrigin = "Anonymous"; // 防止画布污染
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

    // 第一遍遍历：基于 HSV 容错算法分类像素
    for (let i = 0; i < pixels.length; i += 4) {
        // 忽略完全透明的像素
        if (pixels[i+3] === 0) continue; 
        
        let hsv = rgbToHsv(pixels[i], pixels[i+1], pixels[i+2]);
        let pixelIndex = i / 4;

        // 纠偏逻辑：捕获边缘半透明或不纯粹的颜色
        if (hsv.v < 20) {
            // 捕获为黑色墙壁 (V 极低)
            wallCount++;
        } else if ((hsv.h < 15 || hsv.h > 345) && hsv.s > 50 && hsv.v > 50) {
            // 捕获为红色出生点 (H 约等于 0)
            spawns.push(pixelIndex);
        } else if (hsv.h > 100 && hsv.h < 150 && hsv.s > 50 && hsv.v > 50) {
            // 捕获为绿色终点 (H 约等于 125)
            goals.push(pixelIndex);
        }
        // 其他白色或灰色系被忽略，自动作为道路
    }

    // 实例化墙壁
    const geometry = new THREE.BoxGeometry(1, CONFIG.wallHeight, 1);
    // 生成随机色相，S=60, V=100 的颜色
    const randomHue = Math.floor(Math.random() * 360);
    const wallColor = hsvToRgbColor(randomHue, 60, 100);
    const material = new THREE.MeshLambertMaterial({ color: wallColor });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, wallCount);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;
    
    const dummy = new THREE.Object3D();
    let wallIndex = 0;

    // 第二遍遍历：放置模型
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

    // 生成纯黑地面
    const floorGeo = new THREE.PlaneGeometry(width, height);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width/2 - 0.5, 0, height/2 - 0.5); // 偏移0.5对齐网格
    floor.receiveShadow = true;
    scene.add(floor);

    // 设定出生点位置
    if (spawns.length > 0) {
        let spawnPixel = spawns[Math.floor(Math.random() * spawns.length)];
        camera.position.set(spawnPixel % width, CONFIG.viewHeight, Math.floor(spawnPixel / width));
    } else {
        camera.position.set(1, CONFIG.viewHeight, 1); // 默认安全点
    }

    // 设定终点判定范围
    if (goals.length > 0) {
        let goalPixel = goals[Math.floor(Math.random() * goals.length)];
        goalZone.x = goalPixel % width;
        goalZone.z = Math.floor(goalPixel / width);
        goalZone.radius = 2; // 触碰半径
    }
}

// --- 5. 虚拟摇杆与循环 ---
const joystickZone = document.getElementById('joystick-zone');
const knob = document.getElementById('joystick-knob');
let isDragging = false;

joystickZone.addEventListener('touchstart', handleJoystickStart, {passive: false});
joystickZone.addEventListener('touchmove', handleJoystickMove, {passive: false});
joystickZone.addEventListener('touchend', handleJoystickEnd);
joystickZone.addEventListener('mousedown', handleJoystickStart);
document.addEventListener('mousemove', handleJoystickMove);
document.addEventListener('mouseup', handleJoystickEnd);

function handleJoystickStart(e) { 
    if(e.target === joystickZone || e.target === knob) {
        isDragging = true; 
        handleJoystickMove(e); 
    }
}
function handleJoystickEnd() {
    isDragging = false;
    knob.style.transform = `translate(0px, 0px)`;
    moveVector = { x: 0, z: 0 };
}
function handleJoystickMove(e) {
    if (!isDragging) return;
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
    
    moveVector.x = Math.cos(angle);
    moveVector.z = Math.sin(angle);
}

function gameLoop() {
    if (screens.game.classList.contains('active')) {
        let nextX = camera.position.x + moveVector.x * CONFIG.playerSpeed;
        let nextZ = camera.position.z + moveVector.z * CONFIG.playerSpeed;

        let gridX = Math.round(nextX);
        let gridZ = Math.round(nextZ);
        
        // 基于网格的极速碰撞检测
        if (gridX >= 0 && gridX < collisionGrid.length && gridZ >= 0 && gridZ < collisionGrid[0].length) {
            // 滑动碰撞：允许在X或Z单轴上滑动，防止卡死
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