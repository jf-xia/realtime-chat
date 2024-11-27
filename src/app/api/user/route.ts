
export async function GET(request: Request) { 
    return Response.json({ message: 'Hello World' })
}
 
export async function HEAD(request: Request) {}
 
export async function POST(request: Request) {
    return Response.json({ message: 'Hello World!' })
}
 
export async function PUT(request: Request) {}
 
export async function DELETE(request: Request) {}
 
export async function PATCH(request: Request) {}