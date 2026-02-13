import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();

console.log('VAPID Keys Generated!');
console.log('Add these to your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log(`VAPID_EMAIL=mailto:admin@brondau.kz`);
