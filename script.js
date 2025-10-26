const { PI, sin, cos } = Math;
const TAU = 2 * PI;

const map = (value, sMin, sMax, dMin, dMax) => {
    return dMin + (value - sMin) / (sMax - sMin) * (dMax - dMin);
};

const rand = (max, min = 0) => min + Math.random() * (max - min);
const polar = (ang, r = 1) => [r * cos(ang), r * sin(ang)];

let scene, camera, renderer;
let step = 0;

const uniforms = {
    time: { type: "f", value: 0.0 },
    step: { type: "f", value: 0.0 }
};

// ============ 3-4层同心壳圣诞树配置参数 ============
const TREE_POS = [0, 6, -25];       // 树的位置（单棵居中，整体上移+8）
const TREE_Y = [-20.5, 20.5];       // 树的高度范围（H≈41，占屏幕72%）
const BASE_RADIUS = 12.0;           // 底部半径（R0≈12，更繁盛）
const POINT_COUNT = 25000;          // 总粒子数量（22k-28k，更密实）
const POINT_SIZE_RANGE = [0.6, 6.2]; // 粒子大小范围（上限6.2，顶部区×0.75生效）
const ALPHA_MAX = 0.65;             // 最大透明度（α≤0.65，防白糊）
const LAYER_COUNT = 3;              // 层数（3-4层）

// 3层同心壳螺旋参数
const LAYER_CONFIGS = [
    // L1 外圈
    {
        K: 12,           // 圈数
        M: 4,            // 色带数量
        scale: 1.00,     // 半径缩放 s=[1.00, 0.78, 0.58]
        w: 0.24,         // 带宽 w=[0.24, 0.20, 0.18]
        a: 0.18,         // 角度抖动
        ratio: 0.40      // 点数占比40%
    },
    // L2 中圈
    {
        K: 11,
        M: 3,
        scale: 0.78,
        w: 0.20,
        a: 0.16,
        ratio: 0.30      // 点数占比30%
    },
    // L3 内圈（可反向）
    {
        K: 10,           // 最内层可不反向，或 K=-9
        M: 3,
        scale: 0.58,
        w: 0.18,
        a: 0.14,
        ratio: 0.20      // 点数占比20%
    }
];

// 全局螺旋参数
const SPIRAL_GLOBAL = {
    p: 1.20,           // 锥度
    m: 0.04,           // 半径波纹幅度
    N: 3,              // 每高段起伏次数
    B: 2,              // 角度抖动频率
    uSamples: 2        // 带内采样数
};

// 顶部抑制参数
const TOP_SUPPRESSION = {
    t_top: 0.80,       // 顶部抑制区起始（提前到80%）
    density_factor: 0.20,  // 点密度×0.20（更激进抑制）
    bandwidth_factor: 0.50, // 带宽×0.50（更窄）
    size_factor: 0.70,     // 点大小×0.70
    t_gap: 0.92,       // t>0.92不采样（扩大留空）
    t_reduce: 0.85,    // t>0.85减少圈数（提前减少）
    phase_offset: 0.35 // 最顶10%相位偏移
};

// 树根配置（随树上移，稍大）
const TRUNK = {
    top: 2.4,
    bottom: 3.8,
    height: 6.0,
    pos: [0, -16.5, -25],   // 配合树上移，保持相对位置
    color: "#8F223A",
    emissive: "#2A0B12",
    roughness: 0.9,
    metalness: 0.0
};

// 顶部星星配置
const TOP_STAR = {
    pos: [0, 26.5, -25],    // 树顶位置（树高41的一半约20.5，再加6到树顶上方）
    size: 2.5,
    rotationSpeed: 0.01
};

// 星星位置（3D坐标）
const STAR_POS_3D = [0, 21.0, -25];

// 颜色配置（3层同心壳 - L1/L2/L3）
const COLOR_LAYERS = [
    // L1 外圈
    [
        { H: [348, 6], S: [78, 90], L: [48, 56] },    // H=348-6
        { H: [344, 352], S: [78, 90], L: [48, 56] },  // H=344-352
        { H: [356, 8], S: [78, 90], L: [48, 56] },    // H=356-8
        { H: [352, 2], S: [78, 90], L: [48, 56] }     // H=352-2（跨360）
    ],
    // L2 中圈 - S-4%, L-2%
    [
        { H: [348, 6], S: [74, 86], L: [46, 54] },
        { H: [344, 352], S: [74, 86], L: [46, 54] },
        { H: [356, 8], S: [74, 86], L: [46, 54] }
    ],
    // L3 内圈 - 在L2基础S-4%, L-2%
    [
        { H: [348, 6], S: [70, 82], L: [44, 52] },
        { H: [344, 352], S: [70, 82], L: [44, 52] },
        { H: [356, 8], S: [70, 82], L: [44, 52] }
    ]
];
const COLOR_TOP_LIGHT = { H: [350, 8], S: [70, 85], L: [50, 56] }; // 顶部高光（L≤0.56，进一步降亮）
const COLOR_SHADOW = { H: [348, 5], S: [55, 75], L: [28, 38] }; // 阴影色
// ============================================

const totalPoints = POINT_COUNT;

function init() {
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.zIndex = '2';
    document.body.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        1,
        1000
    );

    camera.position.set(-0.09397456774197047, -2.5597086635726947, 24.420789670889008);
    camera.rotation.set(0.10443543723052419, -0.003827152981119352, 0.0004011488708739715);
    
    // 添加环境光和方向光（用于树根照明）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);
    
    // 添加背景星星
    addBackgroundStars(scene);

    // 添加单棵大圣诞树（居中）
    addTree(scene, uniforms, totalPoints, TREE_POS);
    
    // 添加树根
    addTreeTrunk(scene, TRUNK);
    
    // 保存camera引用到全局
    window.camera = camera;
    
    // 添加顶部星星
    addTopStar(scene, TOP_STAR);

    // 初始化时钟和倒计时
    updateTimeDisplay();
    setInterval(updateTimeDisplay, 1000);
    
    // 初始化雪花效果
    initSnow();

    addListeners(camera, renderer);
    animate();
}

function initSnow() {
    new Snow('#snow', {
        color: ['#ffffff', '#e8d5ff', '#f1d4d4', '#f1f6f9'],
        vx: [-1, 1],
        vy: [2, 5],
        va: [45, 180],
        vf: 0.05,
        radius: [3, 8],
        alpha: [0.5, 0.9],
        num: 100
    });
}

function updateTimeDisplay() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    document.getElementById('time').textContent = `${hours}:${minutes}:${seconds}`;
    
    // 计算距离圣诞节的天数
    const christmasYear = now.getFullYear();
    const christmasDate = new Date(christmasYear, 11, 25);
    
    if (now > christmasDate) {
        christmasDate.setFullYear(christmasYear + 1);
    }
    
    const diff = christmasDate - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    document.getElementById('countdown').textContent = `距离圣诞还有 ${days} 天`;
}

function animate(time) {
    step = (step + 1) % 1000;
    uniforms.time.value = time;
    uniforms.step.value = step;
    
    // 更新顶部星星位置
    updateStarPosition();
    
    // 星星闪烁动画
    if (window.topStarElement) {
        const scale = 1 + Math.sin(time * 0.003) * 0.15; // 闪烁效果
        window.topStarElement.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
    
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function addTree(scene, uniforms, totalPoints, treePosition) {
    const vertexShader = `
        attribute float mIndex;
        varying vec3 vColor;
        varying float opacity;
        uniform float time;
        uniform float step;
        float norm(float value, float min, float max ){
            return (value - min) / (max - min);
        }
        float lerp(float norm, float min, float max){
            return (max - min) * norm + min;
        }
        float map(float value, float sourceMin, float sourceMax, float destMin, float destMax){
            return lerp(norm(value, sourceMin, sourceMax), destMin, destMax);
        }
                                   void main() {
              vColor = color;
              vec3 p = position;
              
              // 添加轻微的摇摆动画
              float t = time * 0.0003;
              float sway = sin(t + mIndex * 0.05) * 0.1;
              p.x += sway;
              
              vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
              
              // 闪烁效果
              float twinkle = sin(t * 2.0 + mIndex) * 0.2 + 1.0;
              
              // 透明度随距离变化，最大0.65（防白糊，进一步降低）
              opacity = map(mvPosition.z , -200.0, 15.0, 0.0, 0.65);
              // 顶部区域点大小×0.70抑制，其他区域上限6.2
              float sizeBase = (mIndex < 0.20) ? 4.0 : 6.0;  // 扩大顶部抑制区到20%
              // 顶部抑制区应用×0.70
              if (mIndex < 0.20) sizeBase *= 0.70;
              float sizeMapped = twinkle * sizeBase;
              gl_PointSize = sizeMapped * ( 200.0 / -mvPosition.z );
              gl_Position = projectionMatrix * mvPosition;
          }
    `;
    
    const fragmentShader = `
        varying vec3 vColor;
        varying float opacity;
        uniform sampler2D pointTexture;
        void main() {
            // 颜色强度整体乘0.85，降低发光叠加的白化倾向
            gl_FragColor = vec4( vColor * 0.85, opacity );
            gl_FragColor = gl_FragColor * texture2D( pointTexture, gl_PointCoord ); 
        }
    `;
    
    const shaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            ...uniforms,
            pointTexture: {
                value: new THREE.TextureLoader().load(`https://assets.codepen.io/3685267/spark1.png`)
            }
        },
        vertexShader,
        fragmentShader,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        transparent: true,
        vertexColors: true
    });

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const mIndexs = [];
    const isInnerRing = [];  // 标记内外圈

    const color = new THREE.Color();

    // HSL转RGB辅助函数
    function hslToRgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r, g, b;
        if (h < 60) [r, g, b] = [c, x, 0];
        else if (h < 120) [r, g, b] = [x, c, 0];
        else if (h < 180) [r, g, b] = [0, c, x];
        else if (h < 240) [r, g, b] = [0, x, c];
        else if (h < 300) [r, g, b] = [x, 0, c];
        else [r, g, b] = [c, 0, x];
        return [r + m, g + m, b + m];
    }
    
    // 计算各层点数
    const layerPoints = LAYER_CONFIGS.map(layer => Math.floor(totalPoints * layer.ratio));
    
    let pointIndex = 0;
    for (let layerIdx = 0; layerIdx < LAYER_CONFIGS.length; layerIdx++) {
        const layerConfig = LAYER_CONFIGS[layerIdx];
        const layerColorBands = COLOR_LAYERS[layerIdx];
        const layerTotalPoints = layerPoints[layerIdx];
        
        for (let j = 0; j < layerTotalPoints; j++) {
            const i = pointIndex++;
            
            // t>0.97不采样（顶部留空）
            let t = Math.random();
            if (t > TOP_SUPPRESSION.t_gap) continue;
            
            // 顶部抑制区：点密度×0.35
            if (t > TOP_SUPPRESSION.t_top && Math.random() > TOP_SUPPRESSION.density_factor) continue;
            
            const y = map(t, 0, 1, TREE_Y[0], TREE_Y[1]);
            
            // 选择色带
            const bandIndex = j % layerConfig.M;
            const phiBase = (2 * PI * bandIndex) / layerConfig.M + layerIdx * (PI / 7); // 相位偏移
            let phi = phiBase;
            
            // 最顶10%额外相位偏移，避免多层线条同向重合
            if (t > 0.90) {
                phi += TOP_SUPPRESSION.phase_offset;
            }
            
            // 半径函数（缩放 + 波纹）
            const r0 = layerConfig.scale * BASE_RADIUS * Math.pow(1 - t, SPIRAL_GLOBAL.p);
            const ripple = 1 + SPIRAL_GLOBAL.m * sin(2 * PI * SPIRAL_GLOBAL.N * t + rand(0, TAU));
            let radius = r0 * ripple;
            
            // t>0.90减少圈数（顶部降绕）
            let K = layerConfig.K;
            if (t > TOP_SUPPRESSION.t_reduce) {
                K = map(t, TOP_SUPPRESSION.t_reduce, 1.0, K, K - 1);
            }
            
            // 角度
            const thetaBase = 2 * PI * K * t + phi;
            const thetaJitter = layerConfig.a * sin(2 * PI * SPIRAL_GLOBAL.B * t);
            const theta = thetaBase + thetaJitter;
            
            // 带宽（顶部×0.60）
            let w = layerConfig.w;
            if (t > TOP_SUPPRESSION.t_top) {
                w *= TOP_SUPPRESSION.bandwidth_factor;
            }
            
            // 带宽采样（环向扩宽）
            const u = map(j % SPIRAL_GLOBAL.uSamples, 0, SPIRAL_GLOBAL.uSamples - 1, -1, 1);
            const tangent = [-sin(theta), 0, cos(theta)];
            const normalLength = Math.sqrt(tangent[0]**2 + tangent[2]**2);
            const normal = [tangent[0] / normalLength, 0, tangent[2] / normalLength];
            
            // 基础螺旋点
            const x0 = radius * cos(theta);
            const z0 = radius * sin(theta);
            
            // 带宽度偏移
            const x = x0 + u * w * normal[0];
            const z = z0 + u * w * normal[2];
            
            // 轻微径向随机抖动（保证轮廓干净）
            const modifier = map(t, 0, 1, 1, 0);
            positions.push(x + rand(-0.10 * modifier, 0.10 * modifier));
            positions.push(y + rand(-0.10 * modifier, 0.10 * modifier));
            positions.push(z + rand(-0.10 * modifier, 0.10 * modifier));

            // 多色带颜色：根据层区分
            let hue, saturation, lightness;
            const bandColor = layerColorBands[bandIndex % layerColorBands.length];
            
            // 顶部抑制区（t > 0.80）：使用顶部高光色（L≤0.56）
            if (t > TOP_SUPPRESSION.t_top) {
                hue = rand(COLOR_TOP_LIGHT.H[0], COLOR_TOP_LIGHT.H[1]) % 360;
                saturation = rand(COLOR_TOP_LIGHT.S[0], COLOR_TOP_LIGHT.S[1]) / 100;
                // 在顶部抑制区进一步降低亮度
                const topLightness = map(t, TOP_SUPPRESSION.t_top, 1.0, COLOR_TOP_LIGHT.L[1]/100, COLOR_TOP_LIGHT.L[0]/100);
                lightness = Math.min(topLightness, COLOR_TOP_LIGHT.L[1]/100);
            }
            // 底部区域（t < 0.12）：10-12%的点使用阴影色
            else if (t < 0.12 && Math.random() < 0.11) {
                hue = rand(COLOR_SHADOW.H[0], COLOR_SHADOW.H[1]) % 360;
                saturation = rand(COLOR_SHADOW.S[0], COLOR_SHADOW.S[1]) / 100;
                lightness = rand(COLOR_SHADOW.L[0], COLOR_SHADOW.L[1]) / 100;
            }
            // 主色区域：自下而上线性提亮（L根据带的不同范围，最高≤0.56）
            else {
                hue = rand(bandColor.H[0], bandColor.H[1]) % 360;
                saturation = rand(bandColor.S[0], bandColor.S[1]) / 100;
                // 亮度随高度线性增长：底部为带L[0]，顶部为带L[1]
                const baseL = bandColor.L[0] / 100;
                const topL = Math.min(bandColor.L[1] / 100, 0.56);  // 严禁≥0.56
                lightness = map(t, 0, 1, baseL, topL);
            }
            
            const [r, g, b] = hslToRgb(hue, saturation, lightness);
            colors.push(r, g, b);
            
            const mIndex = map(j, 0, layerTotalPoints, 1.0, 0.0);
            mIndexs.push(mIndex);
            // 标记层
            isInnerRing.push(layerIdx);
        }
    }

    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    );

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("mIndex", new THREE.Float32BufferAttribute(mIndexs, 1));

    const tree = new THREE.Points(geometry, shaderMaterial);

    const [px, py, pz] = treePosition;

    tree.position.x = px;
    tree.position.y = py;
    tree.position.z = pz;

    scene.add(tree);
}

// 添加树根（圆柱底座）
function addTreeTrunk(scene, trunkConfig) {
    const trunkGeometry = new THREE.CylinderGeometry(
        trunkConfig.top,
        trunkConfig.bottom,
        trunkConfig.height,
        24
    );
    const trunkMaterial = new THREE.MeshStandardMaterial({ 
        color: trunkConfig.color,
        emissive: trunkConfig.emissive,
        roughness: trunkConfig.roughness,
        metalness: trunkConfig.metalness
    });
    
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(...trunkConfig.pos);
    
    scene.add(trunk);
}

// 添加顶部星星（使用emoji）
function addTopStar(scene, starConfig) {
    // 创建DOM元素显示🌟emoji
    const starElement = document.createElement('div');
    starElement.innerHTML = '🌟';
    starElement.style.position = 'fixed';
    starElement.style.pointerEvents = 'none';
    starElement.style.fontSize = '50px';  // 缩小星星大小
    starElement.style.textAlign = 'center';
    starElement.style.zIndex = '1000';
    starElement.style.filter = 'drop-shadow(0 0 20px rgba(255, 215, 0, 0.8))';
    starElement.style.transition = 'transform 0.3s ease';
    document.body.appendChild(starElement);
    
    // 保存星星元素引用
    window.topStarElement = starElement;
    
    // 用于存储星星的屏幕位置
    window.topStarScreenPos = { x: 0, y: 0 };
    
    // 初始化位置更新
    updateStarPosition();
}

// 更新星星位置（将3D坐标投影到2D屏幕）
function updateStarPosition() {
    if (!window.topStarElement || !window.camera) return;
    
    // 获取星星的3D世界坐标
    const worldPos = new THREE.Vector3(...TOP_STAR.pos);
    
    // 投影到屏幕坐标
    const screenPos = worldPos.project(window.camera);
    
    // 转换为屏幕像素坐标
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    
    // 更新星星位置（稍微下移一点）
    window.topStarElement.style.left = `${x}px`;
    window.topStarElement.style.top = `${y - 20}px`;  // 从-40改为-20，向下移动
    window.topStarElement.style.transform = `translate(-50%, -50%)`;
}





function addBackgroundStars(scene) {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    
    for (let i = 0; i < 2000; i++) {
        const x = rand(-100, 100);
        const y = rand(-50, 50);
        const z = rand(-100, 100);
        positions.push(x, y, z);
        
        // 白色和淡蓝色星星
        const color = new THREE.Color();
        if (Math.random() > 0.5) {
            color.set(0xffffff);
        } else {
            color.set(0xadd8e6);
        }
        colors.push(color.r, color.g, color.b);
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 0.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.8
    });
    
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
}

function randChoise(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function addListeners(camera, renderer) {
    window.addEventListener("resize", () => {
        const width = window.innerWidth;
        const height = window.innerHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        
        // 窗口大小改变时更新星星位置
        updateStarPosition();
    }, false);
}

// 音乐控制
function initMusic() {
    const playButton = document.getElementById('playButton');
    const audioPlayer = document.getElementById('audioPlayer');
    let isPlaying = false;

    playButton.addEventListener('click', () => {
        if (isPlaying) {
            audioPlayer.pause();
            playButton.textContent = '🎵 播放音乐';
            isPlaying = false;
        } else {
            audioPlayer.play().catch(err => {
                console.error('播放音乐失败:', err);
                alert('无法播放音乐，请检查浏览器设置');
            });
            playButton.textContent = '⏸️ 暂停音乐';
            isPlaying = true;
        }
    });
}

// 页面加载完成后初始化
init();
initMusic(); 