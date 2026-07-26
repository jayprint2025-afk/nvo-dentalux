import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dentalux.app',
  appName: 'Clinica Dentalux',
  webDir: 'dist',
  server: { androidScheme: 'https' } // OK también para iOS
};

export default config;