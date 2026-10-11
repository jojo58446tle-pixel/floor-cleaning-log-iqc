import { randomBytes, scryptSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Run locally as the site owner. No password is echoed, logged, or committed.
async function hiddenPassword(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  try {
    return await new Promise((resolve,reject) => {
      let value='';
      const onData=chunk=>{
        for(const c of chunk){
          if(c==='\u0003'){done();reject(new Error('Cancelled.'));return;}
          if(c==='\r'||c==='\n'){done();resolve(value);return;}
          if(c==='\u007f'||c==='\b'){value=value.slice(0,-1);continue;}
          if(c>=' '&&c!=='\u001b')value+=c;
        }
      };
      function done(){process.stdin.off('data',onData);process.stdout.write('\n');}
      process.stdin.on('data',onData);
    });
  } finally {process.stdin.setRawMode(false);process.stdin.pause();}
}
try {
  const password=await hiddenPassword('Choose an Admin password (16–256 characters; hidden): ');
  if(password.length<16||password.length>256)throw new Error('Use 16–256 characters.');
  if(password!==await hiddenPassword('Confirm Admin password (hidden): '))throw new Error('Passwords do not match.');
  const salt=randomBytes(24).toString('hex');
  const hash=salt+':'+scryptSync(password,salt,64).toString('hex');
  const secret=randomBytes(48).toString('hex');
  await writeFile('.env.admin',`CLEANING_ADMIN_PASSWORD_HASH=${hash}\nCLEANING_SESSION_SECRET=${secret}\n`,{flag:'wx',mode:0o600});
  console.log('Created .env.admin. Import it into this Netlify site with Functions scope, then redeploy. Keep your Admin password private. Never upload .env.admin to GitHub.');
}catch(error){console.error(error.message);process.exitCode=1;}
