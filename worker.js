let SimplexNoise = null
let noise2d
let blocks
const seed = 1
const water_level = 64
const tree_chance = 64

// Очередь для сообщений
const messageQueue = []

// Флаг для проверки, все ли модули загружены
let importsLoaded = false

// Функция для обработки очереди сообщений
function processQueue() {
    while (messageQueue.length > 0 && importsLoaded) {
        const event = messageQueue.shift()
        handleMessage(event)
    }
}

// Импорты
Promise.all([
    import('./simplex-noise.js').then(async (module) => {
        SimplexNoise = module
        noise2d = module.createNoise2D(pseudoRandom(seed))
    }),
    import('./blocks.js').then(async (module) => {
        blocks = module
    })
]).then(() => {
    importsLoaded = true
    processQueue() // Начинаем обработку очереди сообщений
})

// Обработчик сообщений
function handleMessage(event) {
    const { cmd, data } = event.data

    // console.log('Worker received command:', SimplexNoise, noise2d)

    switch (cmd) {
        case 'generateChunk': {
            const chunk = new Chunk(data.addr, data.coord, data.size)
            const blocks = chunk.generate()
            postMessage({ cmd: 'chunkBlocks', data: { ...data, blocks } })
            break
        }
    }
}

// Получение сообщений
onmessage = (event) => {
    if (importsLoaded) {
        handleMessage(event)
    } else {
        messageQueue.push(event) // Добавляем сообщение в очередь
    }
}


function pseudoRandom(seed) {
    let value = (seed < 0 ? seed + 2147483647 : seed) % 2147483647
    return function() {
        value = (value * 16807) % 2147483647
        return value / 2147483647
    }
}

class Chunk {

    constructor(addr, coord, size) {
        this.addr = addr
        this.coord = coord
        this.size = size
        this.blocks = new Uint8Array(size.x * size.y * size.z)
    }

    setBlock(x, y, z, block) {
        x = Math.floor(x)
        y = Math.floor(y)
        z = Math.floor(z)
        if(!this.isInBounds(x, y, z)) return
        const index = this.getIndex(x, y, z)
        if(!block?.id) debugger
        this.blocks[index] = block.id
    }

    getIndex(x, y, z) {
        return x + y * this.size.x + z * this.size.x * this.size.y
    }

    isInBounds(x, y, z) {
        return x >= 0 && x < this.size.x &&
            y >= 0 && y < this.size.y &&
            z >= 0 && z < this.size.z
    }

    // Генератор
    generate() {

        const { size, addr, coord } = this
        const { blocks_palette, grasses, plants } = blocks

        let n0 = 0
        let n2 = 0
        let ocean = 0
        let planing = 0

        const setBlock = this.setBlock.bind(this)

        function getXZNoise(x, z) {
            const x2 = x + 1024
            const z2 = z + 1024
            n0 = noise2d(x / 2, z / 2)
            const n1 = noise2d(x / 64, z / 64)
            n2 = noise2d(x2 / 16, z2 / 16)
            const n3 = noise2d(x2 / 8, z2 / 8)
            return (n1 * 0.7 + n2 * 0.25 + n3 * 0.05)
        }

        function calcH(x, z) {
            ocean = noise2d((x - 8192) / 384, (z - 8192) / 384)
            planing = (noise2d((x - 1024) / 256, (z - 1024) / 256))
            const height = getXZNoise(x, z) * (32 * ((planing + 1) / 2))
            return Math.ceil (
                (64 + ocean * 16) + (height < 0 ? height : height * 2)
            )
        }

        function drawTree(x, y, z, random) {
            const height = Math.ceil(random() * 8 + 2)
            for(let yy = 0; yy < height; yy++) {
                setBlock(x, y + yy, z, blocks_palette.oak_log)
            }
            // draw leaves
            const radius = {xz: 3, y: 7}
            const ax = x
            const ay = y + height - 2
            const az = z
            for(let xx = -radius.xz; xx <= radius.xz; xx++) {
                for(let yy = 0; yy <= radius.y; yy++) {
                    for(let zz = -radius.xz; zz <= radius.xz; zz++) {
                        if(xx * xx + yy * yy + zz * zz <= radius.xz * radius.xz) {
                            if(xx == 0 && yy < 2 && zz == 0) continue
                            setBlock(ax + xx, ay + yy, az + zz, blocks_palette.oak_leaves)
                        }
                    }
                }
            }
        }

        const random = pseudoRandom(addr.x * 256 + addr.z)

        for(let x = 0; x < size.x; x++) {
            for(let z = 0; z < size.z; z++) {
                const h = calcH(x + coord.x, z + coord.z)
                const max_y = Math.max(h, water_level)
                for(let y = 0; y < max_y; y++) {
                    if(y < h) {
                        let block = blocks_palette.stone
                        const y_from_top = h - y
                        if(y < 80 + n2 * (8 * planing)) {
                            if(y == water_level - 1 && y == h - 1) {
                                block = blocks_palette.sand
                            } else if(y < n0 * 2 + 3) {
                                block = blocks_palette.bedrock
                            } else {
                                if(y_from_top == 1 && y > water_level - 1) {
                                    block = blocks_palette.grass_block
                                    let gr = random()
                                    if(gr < .1) {
                                        gr /= .1
                                        const block = gr < .9 ? grasses[Math.floor((gr/.9) * grasses.length)] : plants[Math.floor(((gr-.9)/.1) * plants.length)]
                                        setBlock(x, y + 1, z, block)
                                    }
                                } else if(y_from_top < 3) {
                                    block = y < water_level ? blocks_palette.gravel : blocks_palette.dirt
                                }
                            }
                        }
                        setBlock(x, y, z, block)
                    } else { //if(y < water_level && y >= h) {
                        setBlock(x, y, z, blocks_palette.water)
                    }
                }
                if(h > water_level && h < 75 && Math.round(random() * tree_chance) == 0) {
                    drawTree(x, h, z, random)
                }
            }
        }

        return this.blocks

    }

}