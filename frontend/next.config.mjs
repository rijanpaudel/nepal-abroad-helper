/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Don't bundle pdf-parse for the server, use it as-is from node_modules
            config.externals = config.externals || [];
            config.externals.push('pdf-parse', 'canvas');
        }
        return config;
    },
};

export default nextConfig;
