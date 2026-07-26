import 'dotenv/config';
import { prisma } from '../src/db.js';

async function main(){
  const names = ['David', 'Yara', 'Angela', 'Paoly'];
  for (const name of names){
    await prisma.doctor.upsert({
      where: { name },
      update: {},
      create: { name, active: true }
    });
  }
  console.log('✅ Seed done');
}
main().finally(()=>prisma.$disconnect());
