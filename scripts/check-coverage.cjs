const data = require('../src/data/ludusavi-games.json');
const games = data.games;

const userGames = [
  { id: '322330', name: "Don't Starve Together" },
  { id: '457140', name: 'Oxygen Not Included' },
  { id: '289070', name: 'Civilization VI' },
  { id: '2661300', name: 'Grounded 2' },
  { id: '2349820', name: "Hero's Land" },
  { id: '219740', name: "Don't Starve" },
  { id: '5022780', name: 'Wanjie: Cycle of Oblivion' },
  { id: '365670', name: 'Blender' },
  { id: '431960', name: 'Wallpaper Engine' },
];

console.log('=== 用户已安装游戏在Ludusavi查找表中的覆盖 ===');
let found = 0;
for (const g of userGames) {
  if (games[g.id]) {
    found++;
    const entry = games[g.id];
    console.log(`  ✓ [${g.id}] ${g.name}`);
    console.log(`    installDir: ${entry.installDir}`);
    console.log(`    configFiles: ${(entry.configFiles || []).join(', ')}`);
    if (entry.configRegistry && entry.configRegistry.length) {
      console.log(`    registry: ${entry.configRegistry.join(', ')}`);
    }
  } else {
    console.log(`  ✗ [${g.id}] ${g.name} (无配置数据)`);
  }
}
console.log(`\n覆盖: ${found}/${userGames.length}`);
console.log(`查找表总游戏数: ${data.totalGames}`);
