module.exports = {
  apps: [
    {
      name: 'coindcx-bot',
      script: 'node_modules/.bin/ts-node',
      args: 'src/index.ts',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      min_uptime: '60s',
      kill_timeout: 10000,
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 200,
      time: true,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        READ_ONLY: 'true',
      },
    },
  ],
};
