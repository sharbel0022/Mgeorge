const jsUrl = value => 'data:text/javascript;base64,' + Buffer.from(value).toString('base64');
export { jsUrl };
